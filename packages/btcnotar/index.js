export { BTCNotar } from "./src/notary.js";
export { BTCNotarClient, sha256Hex, DEFAULT_SERVER_URL } from "./src/client.js";
export { verifyProof } from "./src/verify.js";
export {
    verifyProofFile,
    toProofFile,
    readProofFile,
    writeProofFile,
    checkProofFile,
    PROOF_FORMAT,
    PROOF_VERSION,
} from "./src/prooffile.js";
export { MerkleTree } from "./src/merkle.js";
export { MemoryStore, FileStore } from "./src/store.js";
export {
    MempoolProvider,
    createOpReturnTx,
    buildOpReturnScript,
    encodeOpReturnPayload,
    decodeOpReturnPayload,
    extractOpReturnData,
    MAGIC,
    OP_RETURN_MAX_BYTES,
} from "./src/bitcoin.js";
