import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import "dotenv/config";
import { BTCNotar, FileStore, MempoolProvider, toProofFile } from "btcnotar";
import { createRemoteServer } from "btcnotar-mcp";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Breez SDK Spark (CJS)
import pkg from "@breeztech/breez-sdk-spark";
const { connect, defaultConfig } = pkg;


const app = express();
app.set("etag", false); // stop 304 cache on some browsers
app.set("trust proxy", 1); // Railway is behind a proxy: req.ip = real client IP
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Railway (and most hosts) give the port in PORT.
const PORT = Number(process.env.PORT || 8787);

// ---------------- HARDCODED CONFIG ----------------

const OPRETURN_WIF_MAINNET = process.env.OPRETURN_WIF_MAINNET;
const BREEZ_API_KEY = process.env.BREEZ_API_KEY;
const BREEZ_MNEMONIC = process.env.BREEZ_MNEMONIC;
// Secret key for admin-only endpoints (manual transactions, balance, debug).
// Send it in the "x-admin-key" header. If not set, admin endpoints are disabled.
const ADMIN_KEY = process.env.ADMIN_KEY || "";


// Lightning price (sats) and expiry (seconds)
const LN_PRICE_SATS = 1000;
const LN_EXPIRY_SEC = 900;

// storage dir for Breez SDK
// Where data is saved. On Railway mount a Volume (e.g. at /data) and set DATA_DIR=/data,
// otherwise every redeploy deletes the queue and all proofs.
const DATA_DIR = process.env.DATA_DIR || "";
const BREEZ_STORAGE_DIR = DATA_DIR ? `${DATA_DIR}/breez-data` : "./.breez-data";
const NOTARY_STORE_PATH = DATA_DIR ? `${DATA_DIR}/notary-store.json` : "./.data/notary-store.json";
// --------------------------------------------------

// In-memory invoice store: checkingId -> { paymentRequest, createdAt, amountSats, description }
const invoices = new Map();

// Paid invoices that can still be used for ONE /api/opreturn call: checkingId -> paidAt
const paidTokens = new Map();
const PAID_TOKEN_TTL_MS = 30 * 60 * 1000;

// --------------- Admin auth ---------------
function sha256(s) {
    return crypto.createHash("sha256").update(String(s)).digest();
}

function isAdmin(req) {
    if (!ADMIN_KEY) return false;
    const given = req.get("x-admin-key") || "";
    return crypto.timingSafeEqual(sha256(given), sha256(ADMIN_KEY));
}

function requireAdmin(req, res) {
    if (!ADMIN_KEY) {
        res.status(503).json({ error: "admin endpoints disabled (ADMIN_KEY not set)" });
        return false;
    }
    if (!isAdmin(req)) {
        res.status(401).json({ error: "unauthorized" });
        return false;
    }
    return true;
}

// Take a paid, unused invoice token (one-time). Returns true if it was valid.
function consumePaidToken(checkingId) {
    const paidAt = paidTokens.get(checkingId);
    if (!paidAt) return false;
    paidTokens.delete(checkingId);
    return Date.now() - paidAt < PAID_TOKEN_TTL_MS;
}

// --------------- Breez SDK singleton ---------------
let sdkPromise = null;
async function getSdk() {
    if (sdkPromise) return sdkPromise;

    sdkPromise = (async () => {
        const config = defaultConfig("mainnet");
        config.apiKey = BREEZ_API_KEY;

        const seed = { type: "mnemonic", mnemonic: BREEZ_MNEMONIC, passphrase: undefined };

        const sdk = await connect({
            config,
            seed,
            storageDir: BREEZ_STORAGE_DIR,
        });

        console.log("✅ Breez SDK connected");
        return sdk;
    })();

    return sdkPromise;
}
// --------------------------------------------------

// ================================================================
// Batch notarization (btcnotar library): hashes get queued here and
// anchored together (every SETTLE_INTERVAL_MIN, default 60 min) in a single Merkle-rooted OP_RETURN tx.
// ================================================================
// Free public queue limits (anyone can add hashes; the server pays one tx per batch).
const MAX_PENDING = Number(process.env.MAX_PENDING || 10000);          // max hashes waiting in the queue
const HASH_RATE_PER_MIN = Number(process.env.HASH_RATE_PER_MIN || 30); // max new hashes per IP per minute

// Simple per-IP limit: ip -> { windowStart, count }
const rateHits = new Map();
function rateLimited(ip, limit) {
    const now = Date.now();
    const hit = rateHits.get(ip);
    if (!hit || now - hit.windowStart > 60_000) {
        rateHits.set(ip, { windowStart: now, count: 1 });
        if (rateHits.size > 50_000) rateHits.clear(); // keep memory bounded
        return false;
    }
    hit.count++;
    return hit.count > limit;
}

// Queued hashes are anchored once the oldest one has waited this long (no tx if the queue is empty).
const SETTLE_INTERVAL_MIN = Number(process.env.SETTLE_INTERVAL_MIN || 60);

const notary = OPRETURN_WIF_MAINNET
    ? new BTCNotar({
          wif: OPRETURN_WIF_MAINNET,
          network: "mainnet",
          store: new FileStore({ filePath: NOTARY_STORE_PATH }),
          intervalMs: SETTLE_INTERVAL_MIN * 60 * 1000,
          // Optional: own mempool.space-compatible API (default: mempool.space)
          provider: process.env.NOTARY_MEMPOOL_API ? new MempoolProvider({ apiBase: process.env.NOTARY_MEMPOOL_API }) : undefined,
      })
    : null;

if (notary) {
    notary.start();
    console.log(`⛓️  BTCNotar batching active — address ${notary.address}, settling every ${SETTLE_INTERVAL_MIN} min if hashes are queued`);
} else {
    console.warn("⚠️  OPRETURN_WIF_MAINNET not set — batch notarization endpoints are disabled");
}

function requireNotary(res) {
    if (!notary) {
        res.status(503).json({ error: "Notary not configured: set OPRETURN_WIF_MAINNET" });
        return null;
    }
    return notary;
}

// ----------------- OP_RETURN helpers (single-hash, instant anchor) -----------------
function isValidHashHex(s) {
    return /^[0-9a-f]{64}$/i.test(String(s || "").trim());
}

// ------------------------------------------------------

// =========================
// Lightning (Breez SDK)
// =========================

// POST /api/ln/invoice
// body: { amountSat?, memo?, expirySec? }
// returns: { checking_id, payment_request, amountSat }
app.post("/api/ln/invoice", async (req, res) => {
    try {
        const sdk = await getSdk();

        // Fixed price: the client cannot choose a cheaper amount.
        const amountSats = LN_PRICE_SATS;
        const expirySecs = LN_EXPIRY_SEC;

        // Generate checkingId first and embed into description for reliable matching
        const checkingId = crypto.randomUUID();
        const baseMemo = String(req.body?.memo ?? "Proof-of-Existence").slice(0, 120);
        const description = `${baseMemo} | id:${checkingId}`;

        // ✅ Correct Breez SDK shape (internally tagged enum):
        const resp = await sdk.receivePayment({
            paymentMethod: {
                type: "bolt11Invoice",
                amountSats,
                description,
                expirySecs,
            },
        });

        const paymentRequest = resp?.paymentRequest;
        if (!paymentRequest) {
            return res.status(500).json({ error: "Breez SDK did not return paymentRequest" });
        }

        invoices.set(checkingId, {
            paymentRequest,
            createdAt: Date.now(),
            amountSats,
            description,
        });

        res.json({
            checking_id: checkingId,
            payment_request: paymentRequest,
            amountSat: amountSats,
            expirySec: expirySecs,
            source: "breez-sdk",
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// GET /api/ln/status/:checkingId
// returns: { paid: boolean, found?: boolean, status?: string }
app.get("/api/ln/status/:checkingId", async (req, res) => {
    try {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");

        const sdk = await getSdk();
        const id = String(req.params.checkingId || "");

        const inv = invoices.get(id);
        if (!inv) return res.status(404).json({ error: "unknown checkingId" });

        // expire locally
        if (Date.now() - inv.createdAt > (LN_EXPIRY_SEC + 120) * 1000) {
            invoices.delete(id);
            return res.json({ paid: false, expired: true });
        }

        const list = await sdk.listPayments({});

        const OK_STATUSES = ["completed", "settled", "received", "succeeded"];
        const needle = `id:${id}`;

        const found = (list?.payments || []).find((p) => {
            const status = String(p?.status || "").toLowerCase();
            const desc = p?.details?.description || "";
            const typ = String(p?.paymentType || p?.payment_type || "").toLowerCase();

            // We only care about incoming
            const isReceive = typ ? typ.includes("receive") : true;
            return isReceive && OK_STATUSES.includes(status) && desc.includes(needle);
        });

        if (!found) return res.json({ paid: false });

        // One-time consume: mark paid then remove from map.
        // The paid id can now be used once for /api/opreturn.
        invoices.delete(id);
        paidTokens.set(id, Date.now());
        return res.json({
            paid: true,
            status: String(found.status),
            description: found?.details?.description ?? null,
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Optional debug: see latest payments quickly
app.get("/api/ln/debug/latest", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const sdk = await getSdk();
        const list = await sdk.listPayments({});
        res.json({
            count: (list?.payments || []).length,
            payments: (list?.payments || []).slice(0, 20),
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// =========================
// OP_RETURN (Mainnet, instant single-hash anchor)
// =========================
// Allowed only for: the admin (x-admin-key header) OR a paid Lightning invoice
// (body.checkingId from /api/ln/invoice, after /api/ln/status said paid). One tx per payment.
app.post("/api/opreturn", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    const checkingId = String(req.body?.checkingId || "");
    let usedToken = false;
    try {
        const hashHex = String(req.body?.hashHex || "").trim().toLowerCase();
        if (!isValidHashHex(hashHex)) {
            return res.status(400).json({ error: "hashHex must be 64 hex chars" });
        }

        // Already on the blockchain: return the existing proof, no payment used, no new tx.
        const existing = await n.getProof(hashHex);
        if (existing) return res.json(anchorResponse(existing, true));

        if (!isAdmin(req)) {
            if (!checkingId || !consumePaidToken(checkingId)) {
                return res.status(402).json({ error: "payment required: pay the Lightning invoice first" });
            }
            usedToken = true;
        }

        // Through the btcnotar library: Merkle batch (with anything else queued), proof saved.
        const proof = await n.anchorNow(hashHex);
        res.json(anchorResponse(proof, proof.alreadyAnchored));
    } catch (e) {
        // The customer paid but the tx failed: give the token back so they can retry.
        if (usedToken) paidTokens.set(checkingId, Date.now());
        res.status(500).json({ error: e?.response?.data || e?.message || String(e) });
    }
});

function anchorResponse(p, alreadyAnchored) {
    return {
        txid: p.txid,
        merkleRoot: p.merkleRoot,
        proof: p.proof,
        alreadyAnchored,
        explorer: `https://mempool.space/tx/${p.txid}`,
        verify: `/api/notary/verify/${p.hash}`,
    };
}

// =========================
// Batch notarization (btcnotar library)
// =========================

class QueueError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Queue one hash with the free-queue limits. Used by the REST API and by MCP.
// Returns the status ({ status: "pending"|"anchored", ... }). Throws QueueError.
async function queueHash(n, rawHash, { ip, admin }) {
    const hash = String(rawHash || "").trim().toLowerCase();
    if (!isValidHashHex(hash)) throw new QueueError(400, "hashHex must be 64 hex chars");

    // Already anchored or already waiting: just report it (no limits needed).
    const known = await n.getStatus(hash);
    if (known) return known;

    if (!admin) {
        if (rateLimited(ip, HASH_RATE_PER_MIN)) {
            throw new QueueError(429, `too many requests: max ${HASH_RATE_PER_MIN} hashes per minute`);
        }
        if ((await n.pendingCount()) >= MAX_PENDING) {
            throw new QueueError(503, "queue is full, try again after the next settlement");
        }
    }
    await n.addHash(hash);
    return n.getStatus(hash);
}

// Portable proof file for an anchored hash (block info read from the chain).
async function proofFileFor(n, hash, server) {
    const status = await n.getStatus(hash);
    if (!status) throw new QueueError(404, "no proof found for that hash");
    if (status.status === "pending") {
        throw new QueueError(202, `not anchored yet (pending until ${status.nextSettleAt ?? "next settlement"})`);
    }
    let record = status;
    const check = await n.verify(hash).catch(() => null);
    if (check?.valid) record = { ...status, blockHeight: check.blockHeight, blockHash: check.blockHash, blockTime: check.blockTime };
    return toProofFile(record, { network: n.networkName || "mainnet", server });
}

// Same checks as BTCNotarClient.verify(), but on this server.
async function verifyHash(n, rawHash) {
    const hash = String(rawHash || "").trim().toLowerCase();
    if (!isValidHashHex(hash)) throw new QueueError(400, "hash must be 64 hex chars");
    const status = await n.getStatus(hash);
    if (!status) return { valid: false, reason: "unknown-hash" };
    if (status.status === "pending") return { valid: false, reason: "pending", nextSettleAt: status.nextSettleAt };
    return n.verify(hash);
}

function publicUrl(req) {
    return `${req.protocol}://${req.get("host")}`;
}

// POST /api/notary/hash  body: { hashHex }
// Queue a hash for the next automatic settlement.
app.post("/api/notary/hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const status = await queueHash(n, req.body?.hashHex, { ip: req.ip, admin: isAdmin(req) });
        res.json({ ...status, pendingCount: await n.pendingCount() });
    } catch (e) {
        res.status(e instanceof QueueError ? e.status : 500).json({ error: e?.message || String(e) });
    }
});


// POST /api/notary/hashes  body: { hashes: [hashHex, ...] }  (max 100)
// Queue many hashes in one request. Each hash gets its own result:
// { hash, status, ... } or { hash, error }. Rate limit counts every new hash.
app.post("/api/notary/hashes", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const list = req.body?.hashes;
        if (!Array.isArray(list) || list.length === 0) return res.status(400).json({ error: "hashes must be a non-empty array" });
        if (list.length > 100) return res.status(400).json({ error: "max 100 hashes per request" });

        const opts = { ip: req.ip, admin: isAdmin(req) };
        const results = [];
        for (const raw of list) {
            try {
                results.push(await queueHash(n, raw, opts));
            } catch (e) {
                if (!(e instanceof QueueError)) throw e;
                results.push({ hash: raw, error: e.message });
            }
        }
        res.json({ results, pendingCount: await n.pendingCount() });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// POST /api/notary/settle
// Force-settle the current batch immediately (normally happens automatically).
app.post("/api/notary/settle", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const n = requireNotary(res);
    if (!n) return;
    try {
        const batch = await n.settle();
        res.json(batch || { message: "nothing pending" });
    } catch (e) {
        res.status(500).json({ error: e?.response?.data || e?.message || String(e) });
    }
});

// GET /api/notary/proof/:hash
// 200 = anchored (proof), 202 = waiting in the queue, 404 = unknown
app.get("/api/notary/proof/:hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const status = await n.getStatus(String(req.params.hash || "").toLowerCase());
        if (!status) return res.status(404).json({ error: "no proof found for that hash" });
        res.status(status.status === "pending" ? 202 : 200).json(status);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});


// GET /api/notary/prooffile/:hash
// Download the proof as a portable file (<hash>.btcnotar.json). With it the user
// can verify later WITHOUT this server (only the Bitcoin blockchain).
app.get("/api/notary/prooffile/:hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const hash = String(req.params.hash || "").trim().toLowerCase();
        if (!isValidHashHex(hash)) return res.status(400).json({ error: "hash must be 64 hex chars" });
        const file = await proofFileFor(n, hash, publicUrl(req));
        res.setHeader("Content-Disposition", `attachment; filename="${hash}.btcnotar.json"`);
        res.json(file);
    } catch (e) {
        res.status(e instanceof QueueError ? e.status : 500).json({ error: e?.message || String(e) });
    }
});

// GET /api/notary/verify/:hash
// Cryptographically re-derives the Merkle root from the hash + its proof,
// then cross-checks it against the live on-chain transaction: unambiguous
// proof of whether (and when, in which tx/block) a hash was anchored.
app.get("/api/notary/verify/:hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const hash = String(req.params.hash || "").toLowerCase();
        const status = await n.getStatus(hash);
        if (status?.status === "pending") return res.json({ valid: false, reason: "pending", nextSettleAt: status.nextSettleAt });
        res.json(await n.verify(hash));
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// =========================
// Remote MCP server (Streamable HTTP) for AI agents: https://<host>/mcp
// Add this URL as a custom connector in Claude, ChatGPT, Cursor, ...
// Stateless: a new MCP server per request; same free-queue limits per IP.
// =========================
function mcpBackend(n, req) {
    const opts = { ip: req.ip, admin: false };
    return {
        network: n.networkName || "mainnet",
        submit: (hash) => queueHash(n, hash, opts),
        async submitMany(hashes) {
            const out = [];
            for (const h of hashes) {
                try {
                    out.push(await queueHash(n, h, opts));
                } catch (e) {
                    if (!(e instanceof QueueError)) throw e;
                    out.push({ hash: h, error: e.message });
                }
            }
            return out;
        },
        verify: (hash) => verifyHash(n, hash),
        downloadProof: (hash) => proofFileFor(n, String(hash || "").trim().toLowerCase(), publicUrl(req)),
    };
}

app.post("/mcp", async (req, res) => {
    if (!notary) return res.status(503).json({ jsonrpc: "2.0", error: { code: -32000, message: "notary not configured" }, id: null });
    try {
        const server = createRemoteServer({ client: mcpBackend(notary, req), proofProvider: notary.provider });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
            transport.close();
            server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (e) {
        console.error("MCP error:", e);
        if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "internal error" }, id: null });
    }
});

// Stateless server: no SSE stream and no sessions.
const mcpNotAllowed = (req, res) =>
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", mcpNotAllowed);
app.delete("/mcp", mcpNotAllowed);

app.get("/", (req, res) => res.redirect("/timestamp.html"));

app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}, data in ${DATA_DIR || "./"}`);
    console.log(`⚡ LN: Breez SDK bolt11Invoice + listPayments polling`);
});

app.get("/api/balance", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
        const sdk = await getSdk();

        // ✅ тази версия иска GetInfoRequest, дори празен
        const info = await sdk.getInfo({});

        // Някои полета може да са BigInt -> безопасна сериализация
        const safe = JSON.parse(JSON.stringify(info, (_, v) => (
            typeof v === "bigint" ? v.toString() : v
        )));

        // ако има balanceMsat като string/number
        const balanceMsat = Number(safe.balanceMsat ?? safe.balance_msat ?? 0);
        const balanceSat = balanceMsat / 1000;

        res.json({
            balanceSat,
            balanceMsat,
            raw: safe
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});
