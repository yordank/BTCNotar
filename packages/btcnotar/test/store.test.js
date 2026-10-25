import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore, FileStore } from "../src/store.js";

function makeBatch(batchId, hashes) {
    return { batchId, hashes, txid: "t".repeat(64) };
}

function tmpFile() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-store-"));
    return { dir, filePath: path.join(dir, "nested", "store.json") };
}

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

test("MemoryStore: addPending/listPending/clearPending", async () => {
    const store = new MemoryStore();
    await store.addPending({ id: "1", hash: A });
    await store.addPending({ id: "2", hash: B });

    const list = await store.listPending();
    assert.deepEqual(list.map((e) => e.id), ["1", "2"]);

    // listPending returns a copy, not the internal array.
    list.push({ id: "x" });
    assert.equal((await store.listPending()).length, 2);

    await store.clearPending(["1"]);
    assert.deepEqual((await store.listPending()).map((e) => e.id), ["2"]);
});

test("MemoryStore: saveBatch/getBatch/findBatchByHash/listBatches", async () => {
    const store = new MemoryStore();
    const batch = makeBatch("root1", [A, B]);
    await store.saveBatch(batch);

    assert.deepEqual(await store.getBatch("root1"), batch);
    assert.equal(await store.getBatch("missing"), null);

    assert.deepEqual(await store.findBatchByHash(A), batch);
    assert.deepEqual(await store.findBatchByHash(B.toUpperCase()), batch);
    assert.equal(await store.findBatchByHash(C), null);

    assert.deepEqual(await store.listBatches(), [batch]);
});

test("FileStore: requires a filePath", () => {
    assert.throws(() => new FileStore({}), /requires a filePath/);
});

test("FileStore: starts empty when the file does not exist", async () => {
    const { dir, filePath } = tmpFile();
    try {
        const store = new FileStore({ filePath });
        assert.deepEqual(await store.listPending(), []);
        assert.deepEqual(await store.listBatches(), []);
        assert.equal(fs.existsSync(filePath), false);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("FileStore: persists pending and batches across instances", async () => {
    const { dir, filePath } = tmpFile();
    try {
        const store = new FileStore({ filePath });
        await store.addPending({ id: "1", hash: A });
        await store.addPending({ id: "2", hash: B });
        await store.clearPending(["1"]);
        const batch = makeBatch("root1", [A, C]);
        await store.saveBatch(batch);
        assert.ok(fs.existsSync(filePath));

        const reloaded = new FileStore({ filePath });
        assert.deepEqual((await reloaded.listPending()).map((e) => e.id), ["2"]);
        assert.deepEqual(await reloaded.getBatch("root1"), batch);
        // The hash index is rebuilt on load.
        assert.deepEqual(await reloaded.findBatchByHash(C), batch);
        assert.equal(await reloaded.findBatchByHash(B), null);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("FileStore: throws on a corrupt store file", () => {
    const { dir, filePath } = tmpFile();
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, "{not json");
        assert.throws(() => new FileStore({ filePath }), SyntaxError);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
