import { MerkleTree } from "./merkle.js";
import { extractOpReturnData } from "./bitcoin.js";

/**
 * Verify a proof record against the live blockchain, trusting nobody:
 * (1) recompute the Merkle root from the hash + proof,
 * (2) fetch the transaction from the chain and check its OP_RETURN carries that root.
 *
 * record: { merkleRoot, proof, txid }  (as returned by getProof / a notary server)
 * provider: anything with fetchTransaction(txid), e.g. MempoolProvider
 */
export async function verifyProof(hashHex, record, provider) {
    const hash = String(hashHex).toLowerCase();
    if (!record || !record.merkleRoot || !record.txid || !Array.isArray(record.proof)) {
        return { valid: false, reason: "no-proof-found" };
    }

    if (!MerkleTree.verifyProof(hash, record.proof, record.merkleRoot)) {
        return { valid: false, reason: "merkle-proof-mismatch" };
    }

    const tx = await provider.fetchTransaction(record.txid);
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
