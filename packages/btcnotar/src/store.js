import fs from "node:fs";
import path from "node:path";

/**
 * In-memory store: hashes waiting for the next settlement batch, and
 * settled batches keyed by batchId (= their Merkle root), indexed by the
 * individual document hashes they contain. This is also the base class
 * for FileStore below.
 */
export class MemoryStore {
    constructor() {
        this.pending = [];
        this.batches = new Map();
        this.hashIndex = new Map();
    }

    async addPending(entry) {
        this.pending.push(entry);
        return entry;
    }

    async listPending() {
        return [...this.pending];
    }

    async clearPending(ids) {
        const remove = new Set(ids);
        this.pending = this.pending.filter((e) => !remove.has(e.id));
    }

    async saveBatch(batch) {
        this.batches.set(batch.batchId, batch);
        for (const h of batch.hashes) this.hashIndex.set(h, batch.batchId);
        return batch;
    }

    async getBatch(batchId) {
        return this.batches.get(batchId) || null;
    }

    async findBatchByHash(hashHex) {
        const batchId = this.hashIndex.get(hashHex.toLowerCase());
        return batchId ? this.batches.get(batchId) || null : null;
    }

    async listBatches() {
        return [...this.batches.values()];
    }
}

/**
 * JSON-file-backed store: same interface as MemoryStore, persisted to disk
 * after every write so pending hashes and settled batches survive process
 * restarts. Fine for a single-process daemon; swap in a real database for
 * anything with concurrent writers.
 */
export class FileStore extends MemoryStore {
    constructor({ filePath }) {
        super();
        if (!filePath) throw new Error("FileStore requires a filePath");
        this.filePath = filePath;
        this._load();
    }

    _load() {
        try {
            const raw = fs.readFileSync(this.filePath, "utf8");
            const data = JSON.parse(raw);
            this.pending = data.pending || [];
            this.batches = new Map(Object.entries(data.batches || {}));
            this._reindex();
        } catch (e) {
            if (e.code !== "ENOENT") throw e;
        }
    }

    _reindex() {
        this.hashIndex = new Map();
        for (const batch of this.batches.values()) {
            for (const h of batch.hashes) this.hashIndex.set(h, batch.batchId);
        }
    }

    _persist() {
        const data = {
            pending: this.pending,
            batches: Object.fromEntries(this.batches),
        };
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
    }

    async addPending(entry) {
        await super.addPending(entry);
        this._persist();
        return entry;
    }

    async clearPending(ids) {
        await super.clearPending(ids);
        this._persist();
    }

    async saveBatch(batch) {
        await super.saveBatch(batch);
        this._persist();
        return batch;
    }
}
