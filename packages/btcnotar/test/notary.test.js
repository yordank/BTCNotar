import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { BTCNotar } from "../src/notary.js";
import { MemoryStore } from "../src/store.js";
import { encodeOpReturnPayload } from "../src/bitcoin.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);

function sha256hex(s) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

function testWif() {
    const keyPair = ECPair.makeRandom({ network: bitcoin.networks.testnet });
    return keyPair.toWIF();
}

/**
 * Minimal in-memory chain simulator implementing the same interface as
 * MempoolProvider, so settle()/verify() can be exercised end-to-end
 * without any network access.
 */
class FakeProvider {
    constructor() {
        this.broadcasted = new Map(); // txid -> { rawHex, vout, confirmed }
    }

    async fetchUtxos() {
        return [{ txid: "f".repeat(64), vout: 0, value: 100000 }];
    }

    async fetchFeeRateSatVb() {
        return 5;
    }

    async broadcastTx(rawHex) {
        const tx = bitcoin.Transaction.fromHex(rawHex);
        const txid = tx.getId();
        this.broadcasted.set(txid, {
            vout: tx.outs.map((o) => ({ scriptpubkey: Buffer.from(o.script).toString("hex"), value: Number(o.value) })),
        });
        return txid;
    }

    async fetchTransaction(txid) {
        const tx = this.broadcasted.get(txid);
        if (!tx) return null;
        return {
            txid,
            confirmed: true,
            blockHeight: 900000,
            blockHash: "b".repeat(64),
            blockTime: 1750000000,
            vout: tx.vout,
        };
    }
}

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
