import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { BTCNotar } from "../src/notary.js";
import { MemoryStore } from "../src/store.js";
import { encodeOpReturnPayload } from "../src/bitcoin.js";
import { FakeProvider, sha256hex, testWif } from "./helpers.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

test("settle() anchors a batch and each hash gets a verifiable proof", async () => {
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider });

    const docs = ["doc-1", "doc-2", "doc-3"].map(sha256hex);
    for (const h of docs) await notary.addHash(h);
    assert.equal(await notary.pendingCount(), 3);

    const batch = await notary.settle();
    assert.ok(batch.txid);
    assert.equal(batch.hashes.length, 3);
    assert.equal(await notary.pendingCount(), 0);

    for (const h of docs) {
        const result = await notary.verify(h);
        assert.equal(result.valid, true, `expected ${h} to verify: ${JSON.stringify(result)}`);
        assert.equal(result.confirmed, true);
        assert.equal(result.txid, batch.txid);
        assert.equal(result.blockHeight, 900000);
        assert.equal(result.date, new Date(1750000000 * 1000).toISOString());
    }
});

test("verify() fails for a hash that was never submitted", async () => {
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider });
    await notary.addHash(sha256hex("doc-1"));
    await notary.settle();

    const result = await notary.verify(sha256hex("never-submitted"));
    assert.equal(result.valid, false);
    assert.equal(result.reason, "no-proof-found");
});

test("verify() detects on-chain tampering when the stored root doesn't match the broadcast tx", async () => {
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider });
    const hash = sha256hex("doc-1");
    await notary.addHash(hash);
    const batch = await notary.settle();

    // Simulate the on-chain data having anchored a *different* root than
    // the one recorded locally.
    provider.broadcasted.get(batch.txid).vout = [
        {
            scriptpubkey: Buffer.from(
                bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, encodeOpReturnPayload(sha256hex("different-batch"))])
            ).toString("hex"),
            value: 0,
        },
    ];

    const result = await notary.verify(hash);
    assert.equal(result.valid, false);
    assert.equal(result.reason, "on-chain-data-mismatch");
});

test("settle() is a no-op when nothing is pending", async () => {
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: new FakeProvider() });
    assert.equal(await notary.settle(), null);
});

test("settleIfDue() waits until the oldest pending hash is intervalMs old", async () => {
    const HOUR = 60 * 60 * 1000;
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider, intervalMs: HOUR });

    assert.equal(await notary.settleIfDue(), null, "empty queue: no tx");

    const entry = await notary.addHash(sha256hex("botev12"));
    const added = Date.parse(entry.addedAt);
    await notary.addHash(sha256hex("botevpd1912"));

    assert.equal(await notary.settleIfDue(added + HOUR - 1000), null, "not yet due");
    assert.equal(provider.broadcasted.size, 0);

    const batch = await notary.settleIfDue(added + HOUR);
    assert.ok(batch, "due: batch anchored");
    assert.equal(batch.hashes.length, 2);
    assert.equal(provider.broadcasted.size, 1);
    assert.equal(await notary.pendingCount(), 0);

    assert.equal(await notary.settleIfDue(added + 2 * HOUR), null, "queue empty again: no tx");
});

test("settleIfDue() never runs two settlements at the same time", async () => {
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider, intervalMs: 1 });
    await notary.addHash(sha256hex("x"));
    const later = Date.now() + 10;
    const [a, b] = await Promise.all([notary.settleIfDue(later), notary.settleIfDue(later)]);
    assert.equal([a, b].filter(Boolean).length, 1);
    assert.equal(provider.broadcasted.size, 1);
});

test("anchorNow() anchors one hash immediately and returns a verifiable proof", async () => {
    const provider = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider });
    const h = sha256hex("botev12");

    const p = await notary.anchorNow(h);
    assert.equal(p.alreadyAnchored, false);
    assert.equal(provider.broadcasted.size, 1);
    assert.equal((await notary.verify(h)).valid, true);

    const again = await notary.anchorNow(h);
    assert.equal(again.alreadyAnchored, true, "second call: no new tx");
    assert.equal(again.txid, p.txid);
    assert.equal(provider.broadcasted.size, 1);
});

test("settle() calls run one after another (no double spend)", async () => {
    const provider = new FakeProvider();
    let inFlight = 0;
    let maxInFlight = 0;
    const realBroadcast = provider.broadcastTx.bind(provider);
    provider.broadcastTx = async (raw) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight--;
        return realBroadcast(raw);
    };
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider });
    const [a, b] = await Promise.all([notary.anchorNow(sha256hex("a")), notary.anchorNow(sha256hex("b"))]);
    assert.equal(maxInFlight, 1);
    assert.equal((await notary.verify(sha256hex("a"))).valid, true);
    assert.equal((await notary.verify(sha256hex("b"))).valid, true);
    assert.ok(a.txid && b.txid);
});

test("addHash() does not queue the same hash twice", async () => {
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: new FakeProvider() });
    const a = await notary.addHash(sha256hex("botev12"));
    const b = await notary.addHash(sha256hex("botev12").toUpperCase());
    assert.equal(a.id, b.id);
    assert.equal(await notary.pendingCount(), 1);
});
