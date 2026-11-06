import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as bitcoin from "bitcoinjs-lib";
import { BTCNotar, selectUtxo } from "../src/notary.js";
import { MemoryStore, FileStore } from "../src/store.js";
import { RBF_SEQUENCE } from "../src/bitcoin.js";
import { FakeProvider, sha256hex, testWif } from "./helpers.js";

// Provider whose broadcast fails the first N times.
class FlakyProvider extends FakeProvider {
    constructor({ fails = 1, rejected = false } = {}) {
        super();
        this.fails = fails;
        this.rejected = rejected;
        this.calls = 0;
    }
    async broadcastTx(rawHex) {
        this.calls++;
        if (this.fails > 0) {
            this.fails--;
            const err = new Error(this.rejected ? "sendrawtransaction RPC error: bad-txns" : "socket hang up");
            if (this.rejected) err.response = { status: 400, data: "bad-txns" };
            throw err;
        }
        return super.broadcastTx(rawHex);
    }
}

test("network error: batch stays 'signed' with proofs, and is sent on the next settle", async () => {
    const chain = new FlakyProvider({ fails: 1 });
    const store = new MemoryStore();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store, provider: chain });
    const h = sha256hex("doc");
    await notary.addHash(h);

    await assert.rejects(() => notary.settle(), /socket hang up/);
    const [batch] = await store.listBatches();
    assert.equal(batch.status, "signed");
    assert.ok(batch.rawHex);
    assert.equal(await notary.pendingCount(), 0, "hash is in the signed batch, not lost");
    assert.equal((await notary.getProof(h)).batchStatus, "signed");

    await notary.settle(); // retry
    assert.equal((await store.getBatch(batch.batchId)).status, "broadcast");
    assert.equal((await notary.verify(h)).valid, true);
});

test("restart after crash: new notary instance broadcasts the signed batch", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-"));
    const filePath = path.join(dir, "store.json");
    const wif = testWif();
    const chain = new FlakyProvider({ fails: 1 });
    const h = sha256hex("crash doc");
    try {
        const a = new BTCNotar({ wif, network: "testnet", store: new FileStore({ filePath }), provider: chain });
        await a.addHash(h);
        await assert.rejects(() => a.settle());

        // "restart": new store from disk, new notary
        const b = new BTCNotar({ wif, network: "testnet", store: new FileStore({ filePath }), provider: chain });
        await b.settleIfDue(); // nothing pending, but the signed batch is sent
        const [batch] = await b.store.listBatches();
        assert.equal(batch.status, "broadcast");
        assert.equal(batch.queue, undefined);
        assert.equal((await b.verify(h)).valid, true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("node rejects the tx: batch removed, hashes back in the queue", async () => {
    const chain = new FlakyProvider({ fails: 1, rejected: true });
    const store = new MemoryStore();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store, provider: chain });
    const h = sha256hex("rejected doc");
    await notary.addHash(h);

    await assert.rejects(() => notary.settle(), /bad-txns/);
    assert.equal((await store.listBatches()).length, 0);
    assert.equal(await notary.getProof(h), null);
    assert.equal(await notary.pendingCount(), 1);

    const batch = await notary.settle(); // works now
    assert.equal(batch.status, "broadcast");
    assert.equal((await notary.verify(h)).valid, true);
});

test("no new tx while an older signed batch can't be sent (no double spend)", async () => {
    const chain = new FlakyProvider({ fails: 2 });
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    await notary.addHash(sha256hex("one"));
    await assert.rejects(() => notary.settle());
    await notary.addHash(sha256hex("two"));
    await assert.rejects(() => notary.settle(), /not broadcast yet/);
    assert.equal(await notary.pendingCount(), 1, "'two' still waits in the queue");
    const batch = await notary.settle();
    assert.deepEqual(batch.hashes, [sha256hex("two")]);
});

test("selectUtxo: skips too small UTXOs, prefers confirmed, then biggest", () => {
    const utxos = [
        { txid: "a", vout: 0, value: 500, status: { confirmed: true } },
        { txid: "b", vout: 0, value: 90000, status: { confirmed: false } },
        { txid: "c", vout: 0, value: 20000, status: { confirmed: true } },
        { txid: "d", vout: 0, value: 30000, status: { confirmed: true } },
    ];
    assert.equal(selectUtxo(utxos, 800).txid, "d");
    assert.equal(selectUtxo(utxos, 40000).txid, "b", "unconfirmed is used if it is the only one big enough");
    assert.throws(() => selectUtxo(utxos, 100000, "tb1x"), /big enough.*100000.*90000.*tb1x/);
    assert.throws(() => selectUtxo([], 800, "tb1x"), /No UTXOs.*tb1x/);
});

test("settle uses a UTXO that is big enough (not just the first one)", async () => {
    const chain = new FakeProvider();
    chain.fetchUtxos = async () => [
        { txid: "1".repeat(64), vout: 0, value: 300 },
        { txid: "2".repeat(64), vout: 1, value: 50000 },
    ];
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    await notary.addHash(sha256hex("x"));
    const batch = await notary.settle();
    const tx = bitcoin.Transaction.fromHex(batch.rawHex);
    assert.equal(Buffer.from(tx.ins[0].hash).reverse().toString("hex"), "2".repeat(64));
    assert.equal(tx.ins[0].index, 1);
});

test("anchor tx signals Replace-By-Fee", async () => {
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: new FakeProvider() });
    await notary.addHash(sha256hex("rbf"));
    const batch = await notary.settle();
    const tx = bitcoin.Transaction.fromHex(batch.rawHex);
    assert.equal(tx.ins[0].sequence, RBF_SEQUENCE);
});

test("FileStore writes atomically: no temp file left, file always valid JSON", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-"));
    const filePath = path.join(dir, "store.json");
    try {
        const store = new FileStore({ filePath });
        for (let i = 0; i < 20; i++) {
            await store.addPending({ id: String(i), hash: sha256hex(String(i)), addedAt: new Date().toISOString() });
            JSON.parse(fs.readFileSync(filePath, "utf8"));
        }
        assert.deepEqual(fs.readdirSync(dir), ["store.json"]);
        assert.equal(new FileStore({ filePath }).pending.length, 20);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("deleteBatch removes the batch and its hash index", async () => {
    const store = new MemoryStore();
    await store.saveBatch({ batchId: "r", merkleRoot: "r", hashes: ["aa"], proofs: {} });
    assert.equal(await store.deleteBatch("r"), true);
    assert.equal(await store.findBatchByHash("aa"), null);
    assert.equal(await store.deleteBatch("r"), false);
});
