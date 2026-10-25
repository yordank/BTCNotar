import crypto from "node:crypto";
import axios from "axios";
import { MempoolProvider } from "./bitcoin.js";
import { verifyProof } from "./verify.js";

/** SHA-256 of a string (UTF-8) or Buffer, as hex. */
export function sha256Hex(data) {
    return crypto.createHash("sha256").update(data).digest("hex");
}

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
        this.provider = provider || new MempoolProvider({ network });
        this.http = axios.create({ baseURL: this.serverUrl, timeout: timeoutMs, validateStatus: () => true });
    }

    /** Send a hash to the server's queue. Returns { hash, addedAt, nextSettleAt, ... }. */
    async submit(hashHex) {
        const hash = checkHash(hashHex);
        const res = await this.http.post("/api/notary/hash", { hashHex: hash });
        if (res.status >= 400) throw new Error(`server error ${res.status}: ${res.data?.error || res.statusText}`);
        return res.data;
    }

    /**
     * Ask the server for the proof.
     * Returns the proof record, { status: "pending", ... } while waiting, or null if the server doesn't know the hash.
     */
    async getProof(hashHex) {
        const hash = checkHash(hashHex);
        const res = await this.http.get(`/api/notary/proof/${hash}`);
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
}
