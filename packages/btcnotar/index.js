export { BTCNotar } from "./src/notary.js";
export { BTCNotarClient, sha256Hex } from "./src/client.js";
export { verifyProof } from "./src/verify.js";
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
