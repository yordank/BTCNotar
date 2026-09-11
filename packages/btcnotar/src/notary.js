import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { MerkleTree } from "./merkle.js";
import { MempoolProvider, createOpReturnTx, encodeOpReturnPayload, extractOpReturnData } from "./bitcoin.js";
import { MemoryStore } from "./store.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

const DAY_MS = 24 * 60 * 60 * 1000;

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
        const entry = { id: crypto.randomUUID(), hash: hashHex.toLowerCase(), addedAt: new Date().toISOString() };
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
    async settle() {
        const pending = await this.store.listPending();
        if (!pending.length) return null;

        const hashes = pending.map((p) => p.hash);
        const tree = new MerkleTree(hashes);
        const merkleRoot = tree.root;

        const utxos = await this.provider.fetchUtxos(this.address);
        if (!utxos.length) throw new Error(`No UTXOs available. Fund address: ${this.address}`);

        const feeRate = this.feeRateSatVb || (await this.provider.fetchFeeRateSatVb());
        const feeSat = Math.ceil(140 * feeRate);
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

    /** Start automatic settlement every `intervalMs` (default: once a day). */
    start({ intervalMs } = {}) {
        if (this._timer) return;
        const ms = intervalMs || this.intervalMs;
        this._timer = setInterval(() => {
            this.settle().catch((err) => console.error("[btcnotar] scheduled settle() failed:", err));
        }, ms);
        this._timer.unref?.();
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
        const hash = hashHex.toLowerCase();
        const record = proofRecord || (await this.getProof(hash));
        if (!record) return { valid: false, reason: "no-proof-found" };

        if (!MerkleTree.verifyProof(hash, record.proof, record.merkleRoot)) {
            return { valid: false, reason: "merkle-proof-mismatch" };
        }

        const tx = await this.provider.fetchTransaction(record.txid);
        if (!tx) return { valid: false, reason: "transaction-not-found", txid: record.txid };

        const onChainRoot = extractOpReturnData(tx);
        if (!onChainRoot || onChainRoot !== record.merkleRoot) {
            return { valid: false, reason: "on-chain-data-mismatch", txid: record.txid };
        }

        return {
            valid: true,
            confirmed: !!tx.confirmed,
            txid: record.txid,
            merkleRoot: record.merkleRoot,
            blockHeight: tx.blockHeight ?? null,
            blockHash: tx.blockHash ?? null,
            blockTime: tx.blockTime ?? null,
            date: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
        };
    }
}
