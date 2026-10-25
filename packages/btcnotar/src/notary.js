import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { MerkleTree } from "./merkle.js";
import { MempoolProvider, createOpReturnTx, encodeOpReturnPayload } from "./bitcoin.js";
import { verifyProof } from "./verify.js";
import { MemoryStore } from "./store.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const DAY_MS = 24 * 60 * 60 * 1000;
// Size of our tx: 1 P2WPKH input + OP_RETURN (36 bytes) + change ≈ 157 vB.
const ANCHOR_TX_VBYTES = 160;

function isHex(s) {
    return typeof s === "string" && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}

/**
 * BTCNotar batches document hashes, anchors each batch's Merkle root to
 * Bitcoin via a single OP_RETURN transaction, and hands back per-hash
 * proofs that can be independently and unambiguously verified later
 * against the live chain (which transaction, which block, which date).
 *
 * Typical usage:
 *   const notary = new BTCNotar({ wif, network: "mainnet", store });
 *   await notary.addHash(sha256HexOfSomeDocument);
 *   notary.start();                    // settle once every 24h automatically
 *   ...
 *   const proof = await notary.getProof(hash);
 *   const result = await notary.verify(hash);  // { valid, confirmed, txid, blockHeight, date, ... }
 */
export class BTCNotar {
    constructor({ wif, network = "mainnet", store, provider, feeRateSatVb, intervalMs = DAY_MS } = {}) {
        if (!wif) throw new Error("wif (private key, WIF format) is required");
        this.network = network === "mainnet" ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
        this.keyPair = ECPair.fromWIF(wif, this.network);
        this.address = bitcoin.payments.p2wpkh({ pubkey: this.keyPair.publicKey, network: this.network }).address;
        this.store = store || new MemoryStore();
        this.provider = provider || new MempoolProvider({ network });
        this.feeRateSatVb = feeRateSatVb || null;
        this.intervalMs = intervalMs;
        this._timer = null;
    }

    /** Queue a document hash for the next settlement batch. */
    async addHash(hashHex) {
        if (!isHex(hashHex)) throw new Error(`hash must be a hex string, got "${hashHex}"`);
        const hash = hashHex.toLowerCase();
        const queued = (await this.store.listPending()).find((p) => p.hash === hash);
        if (queued) return queued; // already waiting: don't add it twice
        const entry = { id: crypto.randomUUID(), hash, addedAt: new Date().toISOString() };
        await this.store.addPending(entry);
        return entry;
    }

    /** How many hashes are waiting for the next settlement. */
    async pendingCount() {
        return (await this.store.listPending()).length;
    }

    /**
     * Build a Merkle tree over all currently pending hashes and anchor its
     * root on-chain in one OP_RETURN transaction. Returns the settled batch
     * (including a proof per hash), or null if there was nothing pending.
     */
    settle() {
        // Run settlements one after another (timer + manual call at the same time
        // would otherwise try to spend the same UTXO twice).
        const run = (this._settleChain || Promise.resolve()).then(() => this._settle());
        this._settleChain = run.catch(() => {});
        return run;
    }

    async _settle() {
        const pending = await this.store.listPending();
        if (!pending.length) return null;

        const hashes = pending.map((p) => p.hash);
        const tree = new MerkleTree(hashes);
        const merkleRoot = tree.root;

        const utxos = await this.provider.fetchUtxos(this.address);
        if (!utxos.length) throw new Error(`No UTXOs available. Fund address: ${this.address}`);

        const feeRate = this.feeRateSatVb || (await this.provider.fetchFeeRateSatVb());
        const feeSat = Math.ceil(ANCHOR_TX_VBYTES * feeRate);
        const utxo = utxos[0];

        const payload = encodeOpReturnPayload(merkleRoot);
        const { rawHex, txid } = createOpReturnTx({
            keyPair: this.keyPair,
            fromAddress: this.address,
            utxo,
            dataBuffer: payload,
            feeSat,
            network: this.network,
        });
        const broadcastTxid = await this.provider.broadcastTx(rawHex);

        const proofs = {};
        hashes.forEach((h, i) => {
            if (!(h in proofs)) proofs[h] = tree.getProof(i);
        });

        const batch = {
            batchId: merkleRoot,
            merkleRoot,
            txid: broadcastTxid || txid,
            createdAt: new Date().toISOString(),
            hashes,
            proofs,
            status: "broadcast",
            blockHeight: null,
            blockHash: null,
            blockTime: null,
        };

        await this.store.saveBatch(batch);
        await this.store.clearPending(pending.map((p) => p.id));
        return batch;
    }

    /**
     * Start automatic settlement. A batch is anchored as soon as the OLDEST
     * pending hash has waited `intervalMs` (default: one day). Nothing is sent
     * while the queue is empty. Because the wait is measured from the stored
     * `addedAt` time, a server restart does not reset it.
     */
    start({ intervalMs } = {}) {
        if (this._timer) return;
        if (intervalMs) this.intervalMs = intervalMs;
        const checkMs = Math.min(this.intervalMs, 60_000);
        this._timer = setInterval(() => {
            this.settleIfDue().catch((err) => console.error("[btcnotar] scheduled settle() failed:", err));
        }, checkMs);
        this._timer.unref?.();
    }

    /**
     * Anchor one hash right now (plus anything else already queued) and
     * return its proof. If the hash is already anchored, returns the existing
     * proof without a new transaction (`alreadyAnchored: true`).
     */
    async anchorNow(hashHex) {
        if (!isHex(hashHex)) throw new Error(`hash must be a hex string, got "${hashHex}"`);
        const hash = hashHex.toLowerCase();
        const existing = await this.getProof(hash);
        if (existing) return { ...existing, alreadyAnchored: true };
        await this.addHash(hash);
        await this.settle();
        const proof = await this.getProof(hash);
        if (!proof) throw new Error("anchoring failed: hash not found in any batch");
        return { ...proof, alreadyAnchored: false };
    }

    /** Settle only if the oldest pending hash has waited at least `intervalMs`. Returns the batch or null. */
    async settleIfDue(now = Date.now()) {
        if (this._settling) return null;
        this._settling = true; // set before any await, so two calls can never both pass
        try {
            const pending = await this.store.listPending();
            if (!pending.length) return null;
            const oldest = Math.min(...pending.map((p) => Date.parse(p.addedAt) || now));
            if (now - oldest < this.intervalMs) return null;
            return await this.settle();
        } finally {
            this._settling = false;
        }
    }

    stop() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    /** Look up the stored proof + anchor info for a given document hash. */
    async getProof(hashHex) {
        const hash = hashHex.toLowerCase();
        const batch = await this.store.findBatchByHash(hash);
        if (!batch) return null;
        return {
            hash,
            merkleRoot: batch.merkleRoot,
            proof: batch.proofs[hash],
            txid: batch.txid,
            batchId: batch.batchId,
            createdAt: batch.createdAt,
            blockHeight: batch.blockHeight,
            blockHash: batch.blockHash,
            blockTime: batch.blockTime,
        };
    }

    /** When the queue will be anchored next (oldest pending addedAt + intervalMs), or null if empty. */
    async nextSettleAt() {
        const pending = await this.store.listPending();
        if (!pending.length) return null;
        const oldest = Math.min(...pending.map((p) => Date.parse(p.addedAt) || Date.now()));
        return new Date(oldest + this.intervalMs).toISOString();
    }

    /**
     * Where is this hash? { status: "anchored", ...proof } | { status: "pending", addedAt, nextSettleAt } | null
     */
    async getStatus(hashHex) {
        const hash = String(hashHex).toLowerCase();
        const proof = await this.getProof(hash);
        if (proof) return { status: "anchored", ...proof };
        const queued = (await this.store.listPending()).find((p) => p.hash === hash);
        if (queued) return { status: "pending", hash, addedAt: queued.addedAt, nextSettleAt: await this.nextSettleAt() };
        return null;
    }

    /** Re-fetch a batch's anchoring transaction and update its confirmation status. */
    async refreshStatus(batchId) {
        const batch = await this.store.getBatch(batchId);
        if (!batch) return null;
        const tx = await this.provider.fetchTransaction(batch.txid);
        if (tx) {
            batch.status = tx.confirmed ? "confirmed" : "pending";
            batch.blockHeight = tx.blockHeight;
            batch.blockHash = tx.blockHash;
            batch.blockTime = tx.blockTime;
            await this.store.saveBatch(batch);
        }
        return batch;
    }

    /**
     * The reversibility check: given a document hash, prove — or disprove —
     * that it is anchored on the Bitcoin blockchain.
     *
     * This (1) recomputes the Merkle root from the hash + its stored proof
     * and (2) fetches the anchoring transaction live from the chain and
     * confirms its OP_RETURN output actually carries that same root. Only
     * when both checks agree is the result reported as valid, together with
     * the transaction id, block hash/height and date.
     */
    async verify(hashHex, proofRecord) {
        const record = proofRecord || (await this.getProof(hashHex));
        return verifyProof(hashHex, record, this.provider);
    }
}
