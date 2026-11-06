import fs from "node:fs";
import path from "node:path";
import { MempoolProvider } from "./chain.js";
import { verifyProof } from "./verify.js";
import { sha256Hex, sha256File } from "./hash.js";

/**
 * Portable proof file: everything needed to verify a hash later,
 * WITHOUT any BTCNotar server. Only the Bitcoin blockchain is needed.
 *
 * {
 *   format: "btcnotar-proof", version: 1,
 *   hash, merkleRoot, proof: [{ position, hash }], txid, network,
 *   blockHeight, blockHash, blockTime, date, server, savedAt
 * }
 */
export const PROOF_FORMAT = "btcnotar-proof";
export const PROOF_VERSION = 1;

/** Build a proof file object from a proof record (from a server or a notary). */
export function toProofFile(record, { network = "mainnet", server = null } = {}) {
    if (!record || !record.merkleRoot || !record.txid || !Array.isArray(record.proof)) {
        throw new Error("not an anchored proof record (need merkleRoot, txid and proof)");
    }
    return {
        format: PROOF_FORMAT,
        version: PROOF_VERSION,
        hash: String(record.hash).toLowerCase(),
        merkleRoot: record.merkleRoot,
        proof: record.proof,
        txid: record.txid,
        network,
        blockHeight: record.blockHeight ?? null,
        blockHash: record.blockHash ?? null,
        blockTime: record.blockTime ?? null,
        date: record.blockTime ? new Date(record.blockTime * 1000).toISOString() : null,
        server,
        savedAt: new Date().toISOString(),
    };
}

/** Check the shape of a proof file object. Throws with a clear message if it is wrong. */
export function checkProofFile(obj) {
    if (!obj || obj.format !== PROOF_FORMAT) throw new Error("not a btcnotar proof file");
    if (obj.version !== PROOF_VERSION) throw new Error(`unsupported proof file version: ${obj.version}`);
    if (!/^[0-9a-f]{64}$/.test(obj.hash || "")) throw new Error("proof file: bad hash");
    if (!/^[0-9a-f]{64}$/.test(obj.merkleRoot || "")) throw new Error("proof file: bad merkleRoot");
    if (!/^[0-9a-f]{64}$/.test(obj.txid || "")) throw new Error("proof file: bad txid");
    if (!Array.isArray(obj.proof)) throw new Error("proof file: bad proof");
    return obj;
}

/** Write a proof file to disk (pretty JSON). Atomic: write temp file, then rename. */
export function writeProofFile(filePath, proofFile) {
    checkProofFile(proofFile);
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(proofFile, null, 2) + "\n");
    fs.renameSync(tmp, filePath);
    return filePath;
}

/** Read and check a proof file from disk. */
export function readProofFile(filePath) {
    return checkProofFile(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

/**
 * Verify a proof file against the blockchain. No BTCNotar server is used.
 *
 *   await verifyProofFile("contract.pdf.btcnotar.json", { file: "contract.pdf" })
 *
 * @param {string|object} proofFileOrPath - path to the .json file, or the object itself
 * @param {object} [opts]
 * @param {string|Buffer} [opts.file] - path to the original document; its SHA-256 must match the proof
 * @param {string} [opts.hash] - or: the expected SHA-256 (hex) of the document
 * @param {object} [opts.provider] - blockchain backend (default: MempoolProvider for the file's network)
 */
export async function verifyProofFile(proofFileOrPath, { file, hash, provider } = {}) {
    const pf = typeof proofFileOrPath === "string" ? readProofFile(proofFileOrPath) : checkProofFile(proofFileOrPath);

    let expected = hash ? String(hash).toLowerCase() : null;
    if (file) {
        expected = Buffer.isBuffer(file) ? sha256Hex(file) : await sha256File(file);
    }
    if (expected && expected !== pf.hash) {
        return { valid: false, reason: "document-hash-mismatch", hash: pf.hash, documentHash: expected };
    }

    const chain = provider || new MempoolProvider({ network: pf.network || "mainnet" });
    const result = await verifyProof(pf.hash, pf, chain);
    return { hash: pf.hash, ...result };
}
