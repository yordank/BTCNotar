// Light entry: everything to use a BTCNotar server and verify proofs.
// No bitcoinjs-lib / secp256k1 is loaded.
//   import { BTCNotarClient, verifyProofFile } from "btcnotar/client";
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
export {
    MempoolProvider,
    httpRequest,
    MAGIC,
    encodeOpReturnPayload,
    decodeOpReturnPayload,
    extractOpReturnData,
} from "./src/chain.js";
