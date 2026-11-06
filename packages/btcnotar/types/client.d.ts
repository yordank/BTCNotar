// Types for the light entry "btcnotar/client" (also re-exported by "btcnotar").

export type Network = "mainnet" | "testnet" | "testnet4" | "signet";

export interface ProofStep {
    position: "left" | "right";
    hash: string;
}

/** A transaction as returned by a provider's fetchTransaction(). */
export interface ChainTx {
    txid: string;
    confirmed: boolean;
    blockHeight: number | null;
    blockHash: string | null;
    blockTime: number | null;
    vout: { scriptpubkey: string; value: number }[];
}

export interface Utxo {
    txid: string;
    vout: number;
    value: number;
    status?: { confirmed?: boolean };
}

/** Anything that can read the chain (and, for a notary, send transactions). */
export interface ChainProvider {
    fetchTransaction(txid: string): Promise<ChainTx | null>;
    fetchUtxos?(address: string): Promise<Utxo[]>;
    fetchFeeRateSatVb?(): Promise<number>;
    broadcastTx?(rawHex: string): Promise<string>;
}

export declare class MempoolProvider implements ChainProvider {
    constructor(options?: { network?: Network; apiBase?: string; timeoutMs?: number });
    network: Network;
    apiBase: string;
    timeoutMs: number;
    fetchUtxos(address: string): Promise<Utxo[]>;
    fetchFeeRateSatVb(): Promise<number>;
    broadcastTx(rawHex: string): Promise<string>;
    fetchTransaction(txid: string): Promise<ChainTx | null>;
}

/** Proof record from a server or notary. */
export interface ProofRecord {
    hash: string;
    merkleRoot: string;
    proof: ProofStep[];
    txid: string;
    batchId?: string;
    batchStatus?: "signed" | "broadcast" | "pending" | "confirmed";
    createdAt?: string;
    blockHeight?: number | null;
    blockHash?: string | null;
    blockTime?: number | null;
    status?: "anchored";
}

export interface PendingStatus {
    status: "pending";
    hash: string;
    addedAt?: string;
    nextSettleAt?: string | null;
}

export type VerifyFailReason =
    | "pending"
    | "unknown-hash"
    | "no-proof-found"
    | "merkle-proof-mismatch"
    | "transaction-not-found"
    | "on-chain-data-mismatch"
    | "document-hash-mismatch";

export interface VerifyOk {
    valid: true;
    confirmed: boolean;
    txid: string;
    merkleRoot: string;
    blockHeight: number | null;
    blockHash: string | null;
    blockTime: number | null;
    date: string | null;
    hash?: string;
}

export interface VerifyFail {
    valid: false;
    reason: VerifyFailReason;
    txid?: string;
    nextSettleAt?: string | null;
    hash?: string;
    documentHash?: string;
}

export type VerifyResult = VerifyOk | VerifyFail;

export interface ProofFile {
    format: "btcnotar-proof";
    version: 1;
    hash: string;
    merkleRoot: string;
    proof: ProofStep[];
    txid: string;
    network: Network;
    blockHeight: number | null;
    blockHash: string | null;
    blockTime: number | null;
    date: string | null;
    server: string | null;
    savedAt: string;
}

export type SubmitResult = (ProofRecord | PendingStatus) & { pendingCount?: number };
export type SubmitManyItem = SubmitResult | { hash: string; error: string };

export interface WaitOptions {
    /** How often to ask the server (ms). Default 60000. */
    intervalMs?: number;
    /** Give up after (ms). Default 3 hours. */
    timeoutMs?: number;
    /** Also wait for a block. Default false. */
    confirmed?: boolean;
    onUpdate?: (u: { status: "pending"; nextSettleAt: string | null } | { status: "unconfirmed"; txid: string }) => void;
}

export declare const DEFAULT_SERVER_URL: string;

/** SHA-256 of a string (UTF-8) or Buffer, as hex. */
export declare function sha256Hex(data: string | Buffer | Uint8Array): string;
/** SHA-256 of a file, read as a stream. */
export declare function sha256File(filePath: string): Promise<string>;

export declare class BTCNotarClient {
    constructor(options?: { serverUrl?: string; network?: Network; provider?: ChainProvider; timeoutMs?: number });
    serverUrl: string;
    network: Network;
    provider: ChainProvider;
    submit(hash: string): Promise<SubmitResult>;
    submitMany(hashes: string[]): Promise<SubmitManyItem[]>;
    getProof(hash: string): Promise<ProofRecord | PendingStatus | null>;
    verify(hash: string): Promise<VerifyResult>;
    waitForProof(hash: string, options?: WaitOptions): Promise<ProofRecord>;
    downloadProof(hash: string): Promise<ProofFile>;
    saveProof(hash: string, filePath: string): Promise<ProofFile>;
}

export declare function verifyProof(
    hash: string,
    record: Pick<ProofRecord, "merkleRoot" | "proof" | "txid"> | null | undefined,
    provider: ChainProvider
): Promise<VerifyResult>;

export declare const PROOF_FORMAT: "btcnotar-proof";
export declare const PROOF_VERSION: 1;
export declare function toProofFile(record: ProofRecord, options?: { network?: Network; server?: string | null }): ProofFile;
export declare function checkProofFile(obj: unknown): ProofFile;
export declare function readProofFile(filePath: string): ProofFile;
export declare function writeProofFile(filePath: string, proofFile: ProofFile): string;
export declare function verifyProofFile(
    proofFileOrPath: string | ProofFile,
    options?: { file?: string | Buffer; hash?: string; provider?: ChainProvider }
): Promise<VerifyResult>;

export declare class MerkleTree {
    constructor(hashesHex: string[]);
    leaves: string[];
    readonly root: string;
    getProof(index: number): ProofStep[];
    getProofForHash(hashHex: string): ProofStep[];
    static verifyProof(hashHex: string, proof: ProofStep[], rootHex: string): boolean;
}

export declare const MAGIC: Buffer;
export declare const OP_RETURN_MAX_BYTES: number;
export declare function encodeOpReturnPayload(merkleRootHex: string): Buffer;
export declare function decodeOpReturnPayload(payload: Buffer): string | null;
export declare function extractOpReturnData(tx: Pick<ChainTx, "vout">): string | null;
export declare function httpRequest(
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string>; timeoutMs?: number }
): Promise<any>;
