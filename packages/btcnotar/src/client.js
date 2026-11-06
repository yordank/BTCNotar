import { sha256Hex, sha256File } from "./hash.js";
import { MempoolProvider } from "./chain.js";
import { verifyProof } from "./verify.js";
import { toProofFile, writeProofFile } from "./prooffile.js";

export { sha256Hex, sha256File };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The free public BTCNotar server (used when no serverUrl is given). */
export const DEFAULT_SERVER_URL = "https://proofofexistance-production.up.railway.app";

function checkHash(hashHex) {
    const hash = String(hashHex || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`hash must be 64 hex chars (SHA-256), got "${hashHex}"`);
    return hash;
}

/**
 * Client for a public BTCNotar server. No private key and no bitcoin needed:
 * the server anchors queued hashes on-chain and pays the fee.
 *
 *   const client = new BTCNotarClient();   // free public server by default
 *   await client.submit(sha256Hex("my document"));   // queued
 *   ...after the next settlement...
 *   await client.verify(hash);   // { valid, confirmed, txid, blockHeight, date }
 *
 * verify() does not trust the server: it takes the proof from the server and
 * checks it against the blockchain itself (via mempool.space by default).
 */
export class BTCNotarClient {
    constructor({ serverUrl = DEFAULT_SERVER_URL, network = "mainnet", provider, timeoutMs = 20_000 } = {}) {
        this.serverUrl = serverUrl.replace(/\/+$/, "");
        this.network = network;
        this.provider = provider || new MempoolProvider({ network });
        this.timeoutMs = timeoutMs;
    }

    /** Call the server. Returns { status, data } for any HTTP status (no throw on 4xx/5xx). */
    async _call(method, pathname, body) {
        const res = await fetch(`${this.serverUrl}${pathname}`, {
            method,
            headers: body ? { "content-type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = { error: text };
        }
        return { status: res.status, statusText: res.statusText, data };
    }

    /** Send a hash to the server's queue. Returns { hash, addedAt, nextSettleAt, ... }. */
    async submit(hashHex) {
        const hash = checkHash(hashHex);
        const res = await this._call("POST", "/api/notary/hash", { hashHex: hash });
        if (res.status >= 400) throw new Error(`server error ${res.status}: ${res.data?.error || res.statusText}`);
        return res.data;
    }

    /**
     * Send many hashes. Uses one request per 100 hashes (falls back to one by
     * one if the server is older). Never throws for a single bad hash:
     * returns one result per hash, in the same order — { hash, status, ... } or { hash, error }.
     */
    async submitMany(hashes) {
        if (!Array.isArray(hashes)) throw new Error("submitMany needs an array of hashes");
        const results = [];
        for (let i = 0; i < hashes.length; i += 100) {
            const chunk = hashes.slice(i, i + 100);
            const valid = [];
            const slot = chunk.map((h) => {
                try {
                    valid.push(checkHash(h));
                    return valid.length - 1;
                } catch (e) {
                    return { hash: h, error: e.message };
                }
            });
            let got = [];
            if (valid.length) {
                const res = await this._call("POST", "/api/notary/hashes", { hashes: valid });
                if (res.status === 404) {
                    // old server: no batch route
                    for (const h of valid) got.push(await this.submit(h).catch((e) => ({ hash: h, error: e.message })));
                } else if (res.status >= 400) {
                    throw new Error(`server error ${res.status}: ${res.data?.error || res.statusText}`);
                } else {
                    got = res.data.results;
                }
            }
            for (const s of slot) results.push(typeof s === "number" ? got[s] : s);
        }
        return results;
    }

    /**
     * Ask the server for the proof.
     * Returns the proof record, { status: "pending", ... } while waiting, or null if the server doesn't know the hash.
     */
    async getProof(hashHex) {
        const hash = checkHash(hashHex);
        const res = await this._call("GET", `/api/notary/proof/${hash}`);
        if (res.status === 404) return null;
        if (res.status === 202) return { status: "pending", ...res.data };
        if (res.status >= 400) throw new Error(`server error ${res.status}: ${res.data?.error || res.statusText}`);
        return res.data;
    }

    /** Get the proof from the server and verify it against the blockchain yourself. */
    async verify(hashHex) {
        const hash = checkHash(hashHex);
        const record = await this.getProof(hash);
        if (!record) return { valid: false, reason: "unknown-hash" };
        if (record.status === "pending") return { valid: false, reason: "pending", nextSettleAt: record.nextSettleAt ?? null };
        return verifyProof(hash, record, this.provider);
    }

    /**
     * Wait until the hash is in a Bitcoin transaction, then return its proof record.
     * Polls the server every `intervalMs`. With `confirmed: true` it also waits for a block.
     *
     *   const record = await client.waitForProof(hash);              // ~1 hour
     *   const record = await client.waitForProof(hash, { confirmed: true });
     *
     * Throws if the server does not know the hash, or after `timeoutMs`.
     */
    async waitForProof(hashHex, { intervalMs = 60_000, timeoutMs = 3 * 60 * 60 * 1000, confirmed = false, onUpdate } = {}) {
        const hash = checkHash(hashHex);
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const record = await this.getProof(hash);
            if (!record) throw new Error(`server does not know this hash (submit it first): ${hash}`);
            if (record.status !== "pending") {
                if (!confirmed) return record;
                const check = await verifyProof(hash, record, this.provider);
                if (check.valid && check.confirmed) {
                    return { ...record, blockHeight: check.blockHeight, blockHash: check.blockHash, blockTime: check.blockTime };
                }
                onUpdate?.({ status: "unconfirmed", txid: record.txid });
            } else {
                onUpdate?.({ status: "pending", nextSettleAt: record.nextSettleAt ?? null });
            }
            const left = deadline - Date.now();
            if (left <= 0) throw new Error(`timeout: hash not ${confirmed ? "confirmed" : "anchored"} yet: ${hash}`);
            await sleep(Math.min(intervalMs, left));
        }
    }

    /**
     * Download the proof as a portable proof file object (see SPEC in prooffile.js).
     * Keep it next to your document: with it you can verify later even if this server is gone.
     * Throws if the hash is not anchored yet.
     */
    async downloadProof(hashHex) {
        const hash = checkHash(hashHex);
        const record = await this.getProof(hash);
        if (!record) throw new Error(`server does not know this hash: ${hash}`);
        if (record.status === "pending") throw new Error(`not anchored yet (pending until ${record.nextSettleAt ?? "next settlement"})`);
        // Fill block info from the chain if the server did not have it yet.
        let full = { ...record, hash };
        if (!full.blockHeight) {
            const check = await verifyProof(hash, full, this.provider);
            if (check.valid && check.confirmed) {
                full = { ...full, blockHeight: check.blockHeight, blockHash: check.blockHash, blockTime: check.blockTime };
            }
        }
        return toProofFile(full, { network: this.network, server: this.serverUrl });
    }

    /** Download the proof and save it to `filePath` (JSON). Returns the proof file object. */
    async saveProof(hashHex, filePath) {
        const pf = await this.downloadProof(hashHex);
        writeProofFile(filePath, pf);
        return pf;
    }
}
