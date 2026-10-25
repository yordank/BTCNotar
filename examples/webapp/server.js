import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import "dotenv/config";
import { BTCNotar, FileStore } from "btcnotar";

// Breez SDK Spark (CJS)
import pkg from "@breeztech/breez-sdk-spark";
const { connect, defaultConfig } = pkg;


const app = express();
app.set("etag", false); // stop 304 cache on some browsers
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
// Queued hashes are anchored once the oldest one has waited this long (no tx if the queue is empty).
const SETTLE_INTERVAL_MIN = Number(process.env.SETTLE_INTERVAL_MIN || 60);

const notary = OPRETURN_WIF_MAINNET
    ? new BTCNotar({
          wif: OPRETURN_WIF_MAINNET,
          network: "mainnet",
          store: new FileStore({ filePath: NOTARY_STORE_PATH }),
          intervalMs: SETTLE_INTERVAL_MIN * 60 * 1000,
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

// POST /api/notary/hash  body: { hashHex }
// Queue a hash for the next automatic settlement.
app.post("/api/notary/hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const hashHex = String(req.body?.hashHex || "").trim().toLowerCase();
        if (!isValidHashHex(hashHex)) {
            return res.status(400).json({ error: "hashHex must be 64 hex chars" });
        }
        const entry = await n.addHash(hashHex);
        res.json({ ...entry, pendingCount: await n.pendingCount() });
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
app.get("/api/notary/proof/:hash", async (req, res) => {
    const n = requireNotary(res);
    if (!n) return;
    try {
        const proof = await n.getProof(String(req.params.hash || "").toLowerCase());
        if (!proof) return res.status(404).json({ error: "no proof found for that hash" });
        res.json(proof);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
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
        const result = await n.verify(String(req.params.hash || "").toLowerCase());
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

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
