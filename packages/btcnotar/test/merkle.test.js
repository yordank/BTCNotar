import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { MerkleTree } from "../src/merkle.js";

function sha256hex(s) {
    return crypto.createHash("sha256").update(s).digest("hex");
}

test("single-leaf tree: root is derived from the leaf, proof is empty", () => {
    const hash = sha256hex("document-1");
    const tree = new MerkleTree([hash]);
    const proof = tree.getProof(0);
    assert.equal(proof.length, 0);
    assert.ok(MerkleTree.verifyProof(hash, proof, tree.root));
});

test("even number of leaves: every proof verifies against the root", () => {
    const hashes = ["a", "b", "c", "d"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    hashes.forEach((h, i) => {
        const proof = tree.getProof(i);
        assert.ok(MerkleTree.verifyProof(h, proof, tree.root), `leaf ${i} failed to verify`);
    });
});

test("odd number of leaves: unpaired node is carried up, every proof still verifies", () => {
    const hashes = ["a", "b", "c", "d", "e"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    hashes.forEach((h, i) => {
        const proof = tree.getProof(i);
        assert.ok(MerkleTree.verifyProof(h, proof, tree.root), `leaf ${i} failed to verify`);
    });
});

test("getProofForHash finds the right leaf by value", () => {
    const hashes = ["x", "y", "z"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProofForHash(hashes[2]);
    assert.ok(MerkleTree.verifyProof(hashes[2], proof, tree.root));
});

test("tampered hash fails verification", () => {
    const hashes = ["a", "b", "c"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProof(0);
    const wrongHash = sha256hex("not-a");
    assert.equal(MerkleTree.verifyProof(wrongHash, proof, tree.root), false);
});

test("tampered proof step fails verification", () => {
    const hashes = ["a", "b", "c", "d"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProof(0);
    proof[0] = { ...proof[0], hash: sha256hex("evil") };
    assert.equal(MerkleTree.verifyProof(hashes[0], proof, tree.root), false);
});

test("leaf cannot be replayed as an internal node (domain separation)", () => {
    // A two-leaf tree's root is sha256(0x01 || leafHash(a) || leafHash(b)).
    // Naively treating the two leaf hashes as a valid "proof" for some
    // fabricated third leaf must not verify.
    const hashes = ["a", "b"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const forgedProof = [{ position: "right", hash: tree.getProof(0)[0]?.hash || sha256hex("b") }];
    assert.equal(MerkleTree.verifyProof(sha256hex("forged"), forgedProof, tree.root), false);
});

test("rejects empty input", () => {
    assert.throws(() => new MerkleTree([]));
});
