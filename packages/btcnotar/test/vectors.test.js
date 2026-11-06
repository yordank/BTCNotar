import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MerkleTree, sha256Hex, encodeOpReturnPayload, decodeOpReturnPayload, extractOpReturnData } from "../index.js";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "spec", "test-vectors.json");
const V = JSON.parse(fs.readFileSync(file, "utf8"));

test("vectors: sha256 of UTF-8 text", () => {
    for (const c of V.sha256) {
        assert.equal(Buffer.from(c.text, "utf8").toString("hex"), c.utf8Hex);
        assert.equal(sha256Hex(c.text), c.sha256);
    }
});

test("vectors: Merkle root, proofs and OP_RETURN", () => {
    for (const t of V.trees) {
        const tree = new MerkleTree(t.hashes);
        assert.equal(tree.root, t.merkleRoot, `root, ${t.leaves} leaves`);
        t.hashes.forEach((h, i) => {
            assert.deepEqual(tree.getProof(i), t.proofs[i], `proof ${i}/${t.leaves}`);
            assert.equal(MerkleTree.verifyProof(h, t.proofs[i], t.merkleRoot), true);
        });
        assert.equal(encodeOpReturnPayload(t.merkleRoot).toString("hex"), t.opReturnPayload);
        assert.equal(decodeOpReturnPayload(Buffer.from(t.opReturnPayload, "hex")), t.merkleRoot);
        assert.equal(extractOpReturnData({ vout: [{ scriptpubkey: t.opReturnScript }] }), t.merkleRoot);
    }
});

test("vectors: invalid proofs are rejected", () => {
    assert.ok(V.invalidProofs.length >= 5);
    for (const c of V.invalidProofs) {
        assert.equal(MerkleTree.verifyProof(c.hash, c.proof, c.merkleRoot), false, c.name);
    }
});
