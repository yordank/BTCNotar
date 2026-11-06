import * as bitcoin from "bitcoinjs-lib";

// Protocol magic so an OP_RETURN payload can be recognized as a BTCNotar
// anchor (as opposed to some other protocol's data) before trusting its
// contents as a Merkle root. "BTN1" = format version 1.
export const MAGIC = Buffer.from("BTN1", "ascii");
export const OP_RETURN_MAX_BYTES = 80;
/** nSequence that signals opt-in Replace-By-Fee (BIP 125). */
export const RBF_SEQUENCE = 0xfffffffd;

/** Pack a 32-byte Merkle root (hex) into the on-chain OP_RETURN payload. */
export function encodeOpReturnPayload(merkleRootHex) {
    const root = Buffer.from(merkleRootHex, "hex");
    if (root.length !== 32) throw new Error("merkle root must be 32 bytes");
    const payload = Buffer.concat([MAGIC, root]);
    if (payload.length > OP_RETURN_MAX_BYTES) throw new Error("OP_RETURN payload too large");
    return payload;
}

/** Inverse of encodeOpReturnPayload. Returns null if the magic doesn't match. */
export function decodeOpReturnPayload(payload) {
    if (!Buffer.isBuffer(payload) || payload.length !== MAGIC.length + 32) return null;
    if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) return null;
    return payload.subarray(MAGIC.length).toString("hex");
}

export function buildOpReturnScript(dataBuffer) {
    if (dataBuffer.length > OP_RETURN_MAX_BYTES) throw new Error("OP_RETURN > 80 bytes");
    return bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, dataBuffer]);
}

/**
 * Build, sign and serialize a single-input OP_RETURN transaction spending
 * one P2WPKH UTXO, with the (optional) change sent back to the same address.
 */
export function createOpReturnTx({ keyPair, fromAddress, utxo, dataBuffer, feeSat, network }) {
    const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network });
    const psbt = new bitcoin.Psbt({ network });

    psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        sequence: RBF_SEQUENCE, // opt-in Replace-By-Fee: the fee can be raised later
        witnessUtxo: { script: p2wpkh.output, value: BigInt(utxo.value) },
    });

    psbt.addOutput({ script: buildOpReturnScript(dataBuffer), value: 0n });

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

/**
 * Given a fetched transaction (as returned by a provider's
 * fetchTransaction), locate its OP_RETURN output and decode a BTCNotar
 * Merkle root from it, if present. This is what lets verification check
 * the *actual* on-chain data rather than trusting a locally stored copy.
 */
export function extractOpReturnData(tx) {
    for (const out of tx.vout || []) {
        const scriptHex = out.scriptpubkey;
        if (!scriptHex || !scriptHex.startsWith("6a")) continue; // 0x6a == OP_RETURN
        const decompiled = bitcoin.script.decompile(Buffer.from(scriptHex, "hex"));
        const data = (decompiled || []).find((el) => Buffer.isBuffer(el));
        if (!data) continue;
        const root = decodeOpReturnPayload(data);
        if (root) return root;
    }
    return null;
}

/**
 * Chain data provider backed by the public mempool.space REST API.
 * Swap for a different implementation (e.g. a local bitcoind/Electrum
 * client) as long as it exposes the same four methods.
 */
/**
 * Small fetch() helper. Throws on HTTP errors; the error has
 * `response: { status, data }` (like axios) so callers can tell
 * "rejected by the server" from "network problem" (no `response`).
 */
export async function httpRequest(url, { method = "GET", body, headers, timeoutMs = 20_000 } = {}) {
    const res = await fetch(url, { method, body, headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let data = text;
    if ((res.headers.get("content-type") || "").includes("json")) {
        try {
            data = JSON.parse(text);
        } catch {
            /* keep text */
        }
    }
    if (!res.ok) {
        const msg = typeof data === "string" ? data : data?.error || res.statusText;
        const err = new Error(`HTTP ${res.status} ${method} ${url}: ${msg}`);
        err.response = { status: res.status, data };
        throw err;
    }
    return data;
}

/**
 * Chain data provider backed by the public mempool.space REST API.
 * Swap for a different implementation (e.g. a local bitcoind/Electrum
 * client) as long as it exposes the same four methods.
 */
export class MempoolProvider {
    constructor({ network = "mainnet", apiBase, timeoutMs = 20_000 } = {}) {
        this.network = network;
        this.apiBase = apiBase || (network === "mainnet" ? "https://mempool.space/api" : `https://mempool.space/${network}/api`);
        this.timeoutMs = timeoutMs;
    }

    _get(pathname) {
        return httpRequest(`${this.apiBase}${pathname}`, { timeoutMs: this.timeoutMs });
    }

    async fetchUtxos(address) {
        return this._get(`/address/${address}/utxo`);
    }

    async fetchFeeRateSatVb() {
        try {
            const data = await this._get(`/v1/fees/recommended`);
            return Number(data?.halfHourFee ?? 10);
        } catch {
            return 10;
        }
    }

    async broadcastTx(rawHex) {
        const txid = await httpRequest(`${this.apiBase}/tx`, {
            method: "POST",
            body: rawHex,
            headers: { "Content-Type": "text/plain" },
            timeoutMs: this.timeoutMs,
        });
        return String(txid).trim();
    }

    /**
     * Normalized transaction lookup: { txid, confirmed, blockHeight,
     * blockHash, blockTime, vout: [{ scriptpubkey, value }] }.
     * Returns null if the transaction is not (yet) known to the indexer.
     */
    async fetchTransaction(txid) {
        try {
            const tx = await this._get(`/tx/${txid}`);
            return {
                txid: tx.txid,
                confirmed: !!tx.status?.confirmed,
                blockHeight: tx.status?.block_height ?? null,
                blockHash: tx.status?.block_hash ?? null,
                blockTime: tx.status?.block_time ?? null,
                vout: (tx.vout || []).map((o) => ({ scriptpubkey: o.scriptpubkey, value: o.value })),
            };
        } catch (e) {
            if (e?.response?.status === 404) return null;
            throw e;
        }
    }
}
