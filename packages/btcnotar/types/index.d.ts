// Types for "btcnotar" (full package: client + your own notary).
export * from "./client.js";
import type { ChainProvider, Network, ProofRecord, PendingStatus, ProofFile, VerifyResult, Utxo } from "./client.js";

export interface PendingEntry {
    id: string;
    hash: string;
    addedAt: string;
}

export interface Batch {
    batchId: string;
    merkleRoot: string;
    txid: string;
    createdAt: string;
    hashes: string[];
    proofs: Record<string, { position: "left" | "right"; hash: string }[]>;
    status: "signed" | "broadcast" | "pending" | "confirmed";
    rawHex?: string;
    queue?: PendingEntry[];
    blockHeight: number | null;
    blockHash: string | null;
    blockTime: number | null;
}

/** Storage interface. MemoryStore / FileStore implement it; you can write your own (e.g. a database). */
export interface Store {
    addPending(entry: PendingEntry): Promise<PendingEntry>;
    listPending(): Promise<PendingEntry[]>;
    clearPending(ids: string[]): Promise<void>;
    saveBatch(batch: Batch): Promise<Batch>;
    getBatch(batchId: string): Promise<Batch | null>;
    findBatchByHash(hash: string): Promise<Batch | null>;
    listBatches?(): Promise<Batch[]>;
    deleteBatch?(batchId: string): Promise<boolean>;
}

export declare class MemoryStore implements Store {
    addPending(entry: PendingEntry): Promise<PendingEntry>;
    listPending(): Promise<PendingEntry[]>;
    clearPending(ids: string[]): Promise<void>;
    saveBatch(batch: Batch): Promise<Batch>;
    getBatch(batchId: string): Promise<Batch | null>;
    findBatchByHash(hash: string): Promise<Batch | null>;
    listBatches(): Promise<Batch[]>;
    deleteBatch(batchId: string): Promise<boolean>;
}

export declare class FileStore extends MemoryStore {
    constructor(options: { filePath: string });
    filePath: string;
}

export interface BTCNotarOptions {
    /** Private key (WIF) that pays and signs. */
    wif: string;
    network?: Network;
    store?: Store;
    provider?: ChainProvider;
    /** Fixed fee rate. Default: live from mempool.space. */
    feeRateSatVb?: number;
    /** start() anchors when the oldest queued hash is this old. Default 24 h. */
    intervalMs?: number;
}

export declare class BTCNotar {
    constructor(options: BTCNotarOptions);
    readonly address: string;
    store: Store;
    provider: ChainProvider;
    intervalMs: number;
    addHash(hash: string): Promise<PendingEntry | (ProofRecord & { alreadyAnchored: true })>;
    pendingCount(): Promise<number>;
    settle(): Promise<Batch | null>;
    settleIfDue(now?: number): Promise<Batch | null>;
    anchorNow(hash: string): Promise<ProofRecord & { alreadyAnchored: boolean }>;
    start(options?: { intervalMs?: number }): void;
    stop(): void;
    getProof(hash: string): Promise<ProofRecord | null>;
    getStatus(hash: string): Promise<(ProofRecord & { status: "anchored" }) | PendingStatus | null>;
    nextSettleAt(): Promise<string | null>;
    refreshStatus(batchId: string): Promise<Batch | null>;
    verify(hash: string, proofRecord?: ProofRecord): Promise<VerifyResult>;
    exportProof(hash: string): Promise<ProofFile>;
    saveProof(hash: string, filePath: string): Promise<ProofFile>;
}

export declare function selectUtxo(utxos: Utxo[], feeSat: number, address?: string): Utxo;

export declare const RBF_SEQUENCE: number;
export declare function buildOpReturnScript(dataBuffer: Buffer): Uint8Array;
export declare function createOpReturnTx(args: {
    keyPair: unknown;
    fromAddress: string;
    utxo: Utxo;
    dataBuffer: Buffer;
    feeSat: number;
    network: unknown;
}): { rawHex: string; txid: string };
