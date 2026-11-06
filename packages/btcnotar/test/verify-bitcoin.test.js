import { test } from "node:test";
import assert from "node:assert/strict";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { verifyProof } from "../src/verify.js";
import { MerkleTree } from "../src/merkle.js";
import {
    encodeOpReturnPayload,
    decodeOpReturnPayload,
    buildOpReturnScript,
    createOpReturnTx,
    MAGIC,
    OP_RETURN_MAX_BYTES,
} from "../src/bitcoin.js";
import { sha256hex } from "./helpers.js";

bitcoin.initEccLib(ecc);
const ECPair = ECPairFactory(ecc);
const network = bitcoin.networks.testnet;
const hex = (u8) => Buffer.from(u8).toString("hex");

// One batch of 3 hashes, and a chain that has a tx carrying its root.
function fixture({ confirmed = true, root } = {}) {
    const hashes = ["a", "b", "c"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const txid = "e".repeat(64);
    const onChainRoot = root || tree.root;
    const provider = {
        async fetchTransaction(id) {
            if (id !== txid) return null;
            return {
                txid,
                confirmed,
                blockHeight: confirmed ? 900100 : null,
                blockHash: confirmed ? "f".repeat(64) : null,
                blockTime: confirmed ? 1760000000 : null,
                vout: [{ scriptpubkey: hex(buildOpReturnScript(encodeOpReturnPayload(onChainRoot))), value: 0 }],
            };
        },
    };
    const record = { merkleRoot: tree.root, proof: tree.getProof(1), txid };
    return { hashes, tree, provider, record, txid };
}

test("verifyProof: valid + confirmed", async () => {
    const { hashes, provider, record } = fixture();
    const r = await verifyProof(hashes[1], record, provider);
    assert.deepEqual(r, {
        valid: true,
        confirmed: true,
        txid: record.txid,
        merkleRoot: record.merkleRoot,
        blockHeight: 900100,
        blockHash: "f".repeat(64),
        blockTime: 1760000000,
        date: new Date(1760000000 * 1000).toISOString(),
    });
});

test("verifyProof: valid but not in a block yet", async () => {
    const { hashes, provider, record } = fixture({ confirmed: false });
    const r = await verifyProof(hashes[1].toUpperCase(), record, provider);
    assert.equal(r.valid, true);
    assert.equal(r.confirmed, false);
    assert.equal(r.date, null);
    assert.equal(r.blockHeight, null);
});

test("verifyProof: no-proof-found for missing or broken records", async () => {
    const { hashes, provider, record } = fixture();
    for (const bad of [null, undefined, {}, { ...record, proof: "x" }, { ...record, txid: "" }, { ...record, merkleRoot: null }]) {
        assert.equal((await verifyProof(hashes[1], bad, provider)).reason, "no-proof-found");
    }
});

test("verifyProof: merkle-proof-mismatch (wrong hash or edited proof)", async () => {
    const { hashes, provider, record } = fixture();
    assert.equal((await verifyProof(hashes[0], record, provider)).reason, "merkle-proof-mismatch");
    const edited = { ...record, proof: [{ ...record.proof[0], hash: "0".repeat(64) }, ...record.proof.slice(1)] };
    assert.equal((await verifyProof(hashes[1], edited, provider)).reason, "merkle-proof-mismatch");
    const flipped = { ...record, proof: record.proof.map((s) => ({ ...s, position: s.position === "left" ? "right" : "left" })) };
    assert.equal((await verifyProof(hashes[1], flipped, provider)).reason, "merkle-proof-mismatch");
});

test("verifyProof: transaction-not-found", async () => {
    const { hashes, provider, record } = fixture();
    const r = await verifyProof(hashes[1], { ...record, txid: "1".repeat(64) }, provider);
    assert.deepEqual(r, { valid: false, reason: "transaction-not-found", txid: "1".repeat(64) });
});

test("verifyProof: on-chain-data-mismatch (tx has another root, or no BTN1 data)", async () => {
    const other = fixture({ root: "9".repeat(64) });
    assert.equal((await verifyProof(other.hashes[1], other.record, other.provider)).reason, "on-chain-data-mismatch");

    const { hashes, record, txid } = fixture();
    const noData = { fetchTransaction: async () => ({ txid, confirmed: true, vout: [{ scriptpubkey: "0014" + "00".repeat(20) }] }) };
    assert.equal((await verifyProof(hashes[1], record, noData)).reason, "on-chain-data-mismatch");
});

test("OP_RETURN payload: BTN1 + 32 bytes, round trip, bad input", () => {
    const root = "ab".repeat(32);
    const p = encodeOpReturnPayload(root);
    assert.equal(p.length, 36);
    assert.ok(p.subarray(0, 4).equals(MAGIC));
    assert.equal(p.subarray(0, 4).toString("ascii"), "BTN1");
    assert.equal(decodeOpReturnPayload(p), root);

    assert.throws(() => encodeOpReturnPayload("abcd"), /32 bytes/);
    assert.equal(decodeOpReturnPayload(Buffer.concat([Buffer.from("XXX1"), p.subarray(4)])), null, "wrong magic");
    assert.equal(decodeOpReturnPayload(p.subarray(0, 35)), null, "too short");
    assert.equal(decodeOpReturnPayload("not a buffer"), null);
    assert.throws(() => buildOpReturnScript(Buffer.alloc(OP_RETURN_MAX_BYTES + 1)), /80 bytes/);
});

function txFixture(value) {
    const keyPair = ECPair.makeRandom({ network });
    const fromAddress = bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network }).address;
    const utxo = { txid: "3".repeat(64), vout: 2, value };
    return { keyPair, fromAddress, utxo, dataBuffer: encodeOpReturnPayload("cd".repeat(32)), network };
}

test("createOpReturnTx: OP_RETURN output + change back to the same address", () => {
    const args = txFixture(10_000);
    const { rawHex, txid } = createOpReturnTx({ ...args, feeSat: 800 });
    const tx = bitcoin.Transaction.fromHex(rawHex);
    assert.equal(tx.getId(), txid);
    assert.equal(tx.ins.length, 1);
    assert.equal(tx.outs.length, 2);
    assert.equal(hex(tx.outs[0].script), hex(buildOpReturnScript(args.dataBuffer)));
    assert.equal(Number(tx.outs[0].value), 0);
    assert.equal(bitcoin.address.fromOutputScript(tx.outs[1].script, network), args.fromAddress);
    assert.equal(Number(tx.outs[1].value), 10_000 - 800);
    assert.ok(tx.virtualSize() <= 160, `vsize ${tx.virtualSize()} fits ANCHOR_TX_VBYTES`);
});

test("createOpReturnTx: change below dust goes to the fee (no change output)", () => {
    const { rawHex } = createOpReturnTx({ ...txFixture(1_500), feeSat: 800 }); // change 700 < 1000
    const tx = bitcoin.Transaction.fromHex(rawHex);
    assert.equal(tx.outs.length, 1);
});

test("createOpReturnTx: not enough money for the fee", () => {
    assert.throws(() => createOpReturnTx({ ...txFixture(800), feeSat: 800 }), /Insufficient funds/);
    assert.throws(() => createOpReturnTx({ ...txFixture(500), feeSat: 800 }), /Insufficient funds/);
});
