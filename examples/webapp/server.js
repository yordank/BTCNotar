import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "node:crypto";
import "dotenv/config";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { BTCNotar, FileStore, buildOpReturnScript } from "btcnotar";

// Breez SDK Spark (CJS)
import pkg from "@breeztech/breez-sdk-spark";
const { connect, defaultConfig } = pkg;

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const app = express();
app.set("etag", false); // stop 304 cache on some browsers
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = 8787;

// ---------------- HARDCODED CONFIG ----------------

const OPRETURN_WIF_MAINNET = process.env.OPRETURN_WIF_MAINNET;
const BREEZ_API_KEY = process.env.BREEZ_API_KEY;
const BREEZ_MNEMONIC = process.env.BREEZ_MNEMONIC;

// Mempool API for mainnet
const MEMPOOL_API = "https://mempool.space/api";

// Lightning price (sats) and expiry (seconds)
const LN_PRICE_SATS = 1000;
const LN_EXPIRY_SEC = 900;

// storage dir for Breez SDK
const BREEZ_STORAGE_DIR = "./.breez-data";
// --------------------------------------------------

// In-memory invoice store: checkingId -> { paymentRequest, createdAt, amountSats, description }
const invoices = new Map();

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
// anchored together, once a day, in a single Merkle-rooted OP_RETURN tx.
// ================================================================
const notary = OPRETURN_WIF_MAINNET
    ? new BTCNotar({
          wif: OPRETURN_WIF_MAINNET,
          network: "mainnet",
          store: new FileStore({ filePath: "./.data/notary-store.json" }),
          intervalMs: 24 * 60 * 60 * 1000, // once a day
      })
    : null;

if (notary) {
    notary.start();
    console.log(`⛓️  BTCNotar batching active — address ${notary.address}, settling every 24h`);
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

function createOpReturnTx({ keyPair, fromAddress, utxo, dataHex, feeSat, network }) {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
    const psbt = new bitcoin.Psbt({ network });

    psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: { script: p2wpkh.output, value: BigInt(utxo.value) },
    });

    // OP_RETURN output (0 sats)
    psbt.addOutput({ script: buildOpReturnScript(Buffer.from(dataHex, "hex")), value: 0n });

    // Dust guard (safe buffer)
    const DUST_LIMIT = 1000n;

    let change = BigInt(utxo.value) - BigInt(feeSat);
    if (change <= 0n) throw new Error("Insufficient funds for fee");

    if (change < DUST_LIMIT) change = 0n;
    if (change > 0n) psbt.addOutput({ address: fromAddress, value: change });

    psbt.signAllInputs(keyPair);
    psbt.finalizeAllInputs();

    const tx = psbt.extractTransaction();
    return { rawHex: tx.toHex(), txid: tx.getId() };
}

async function fetchUtxos(address) {
    const res = await axios.get(`${MEMPOOL_API}/address/${address}/utxo`);
    return res.data;
}

async function fetchFeeRateSatVb() {
    try {
        const res = await axios.get(`${MEMPOOL_API}/v1/fees/recommended`);
        return Number(res.data?.halfHourFee ?? 10);
    } catch {
        return 10;
    }
}

async function broadcastTx(rawHex) {
    const res = await axios.post(`${MEMPOOL_API}/tx`, rawHex, {
        headers: { "Content-Type": "text/plain" },
    });
    return res.data; // txid
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

        const amountSats = Number(req.body?.amountSat ?? LN_PRICE_SATS);
        const expirySecs = Number(req.body?.expirySec ?? LN_EXPIRY_SEC);

        if (!Number.isFinite(amountSats) || amountSats <= 0) {
            return res.status(400).json({ error: "amountSat must be a positive number" });
        }

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

        // One-time consume: mark paid then remove from map
        invoices.delete(id);
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
app.post("/api/opreturn", async (req, res) => {
    try {
        const hashHex = String(req.body?.hashHex || "").trim().toLowerCase();
        if (!isValidHashHex(hashHex)) {
            return res.status(400).json({ error: "hashHex must be 64 hex chars" });
        }

        const network = bitcoin.networks.bitcoin;
        const keyPair = ECPair.fromWIF(OPRETURN_WIF_MAINNET, network);
        const { address } = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });

        const utxos = await fetchUtxos(address);
        if (!utxos.length) return res.status(400).json({ error: `No UTXOs. Fund address: ${address}` });

        const feeRate = await fetchFeeRateSatVb();
        const feeSat = Math.ceil(140 * feeRate);

        const utxo = utxos[0];
        const { rawHex, txid } = createOpReturnTx({
            keyPair,
            fromAddress: address,
            utxo,
            dataHex: hashHex,
            feeSat,
            network,
        });

        const broadcasted = await broadcastTx(rawHex);

        res.json({
            txid: broadcasted || txid,
            address,
            fee: feeSat,
            feeRate,
            explorer: `https://mempool.space/tx/${broadcasted || txid}`,
        });
    } catch (e) {
        res.status(500).json({ error: e?.response?.data || e?.message || String(e) });
    }
});

// =========================
// Batch notarization (btcnotar library)
// =========================

// POST /api/notary/hash  body: { hashHex }
// Queue a hash for the next automatic (daily) settlement.
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
// Force-settle the current batch immediately (normally happens once a day automatically).
app.post("/api/notary/settle", async (req, res) => {
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
    console.log(`✅ Server running on http://localhost:${PORT}`);
    console.log(`⚡ LN: Breez SDK bolt11Invoice + listPayments polling`);
});

app.get("/api/balance", async (req, res) => {
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
