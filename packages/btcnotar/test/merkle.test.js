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

// Reference helpers mirroring the documented construction, used to check
// exact root values independently of the tree implementation.
function leafHex(hashHex) {
    return crypto.createHash("sha256").update(Buffer.concat([Buffer.from([0x00]), Buffer.from(hashHex, "hex")])).digest("hex");
}

function nodeHex(leftHex, rightHex) {
    return crypto
        .createHash("sha256")
        .update(Buffer.concat([Buffer.from([0x01]), Buffer.from(leftHex, "hex"), Buffer.from(rightHex, "hex")]))
        .digest("hex");
}

test("root: single leaf equals sha256(0x00 || leaf)", () => {
    const hash = sha256hex("document-1");
    assert.equal(new MerkleTree([hash]).root, leafHex(hash));
});

test("root: matches manual construction for 2 and 3 leaves", () => {
    const [a, b, c] = ["a", "b", "c"].map(sha256hex);
    assert.equal(new MerkleTree([a, b]).root, nodeHex(leafHex(a), leafHex(b)));
    // c is unpaired and carried up unchanged, not duplicated
    assert.equal(new MerkleTree([a, b, c]).root, nodeHex(nodeHex(leafHex(a), leafHex(b)), leafHex(c)));
});

test("root: deterministic, case-insensitive and order-sensitive", () => {
    const hashes = ["a", "b", "c"].map(sha256hex);
    const root = new MerkleTree(hashes).root;
    assert.equal(new MerkleTree(hashes).root, root);
    assert.equal(new MerkleTree(hashes.map((h) => h.toUpperCase())).root, root);
    assert.notEqual(new MerkleTree([...hashes].reverse()).root, root);
});

test("many hashes: every proof verifies for sizes 1..33", () => {
    for (let n = 1; n <= 33; n++) {
        const hashes = Array.from({ length: n }, (_, i) => sha256hex(`doc-${n}-${i}`));
        const tree = new MerkleTree(hashes);
        const maxDepth = Math.ceil(Math.log2(n));
        hashes.forEach((h, i) => {
            const proof = tree.getProof(i);
            assert.ok(proof.length <= maxDepth, `n=${n} leaf ${i}: proof too long`);
            assert.ok(MerkleTree.verifyProof(h, proof, tree.root), `n=${n} leaf ${i} failed to verify`);
        });
    }
});

test("many hashes: proof of one leaf does not verify another leaf", () => {
    const hashes = Array.from({ length: 10 }, (_, i) => sha256hex(`doc-${i}`));
    const tree = new MerkleTree(hashes);
    assert.equal(MerkleTree.verifyProof(hashes[1], tree.getProof(0), tree.root), false);
});

test("proof: positions and sibling hashes for a 4-leaf tree", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map(sha256hex);
    const tree = new MerkleTree([a, b, c, d]);
    assert.deepEqual(tree.getProof(2), [
        { position: "right", hash: leafHex(d) },
        { position: "left", hash: nodeHex(leafHex(a), leafHex(b)) },
    ]);
});

test("proof: rejects out-of-range and non-integer index", () => {
    const tree = new MerkleTree(["a", "b"].map(sha256hex));
    assert.throws(() => tree.getProof(-1));
    assert.throws(() => tree.getProof(2));
    assert.throws(() => tree.getProof(0.5));
});

test("getProofForHash: case-insensitive, throws for unknown hash", () => {
    const hashes = ["x", "y", "z"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProofForHash(hashes[1].toUpperCase());
    assert.ok(MerkleTree.verifyProof(hashes[1], proof, tree.root));
    assert.throws(() => tree.getProofForHash(sha256hex("missing")));
});

test("verify: fails for wrong root or flipped position", () => {
    const hashes = ["a", "b", "c", "d"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProof(0);
    assert.equal(MerkleTree.verifyProof(hashes[0], proof, new MerkleTree(["e"].map(sha256hex)).root), false);
    const flipped = proof.map((s, i) => (i === 0 ? { ...s, position: "left" } : s));
    assert.equal(MerkleTree.verifyProof(hashes[0], flipped, tree.root), false);
});

test("verify: accepts uppercase root, returns false on malformed input", () => {
    const hashes = ["a", "b"].map(sha256hex);
    const tree = new MerkleTree(hashes);
    const proof = tree.getProof(0);
    assert.ok(MerkleTree.verifyProof(hashes[0], proof, tree.root.toUpperCase()));
    assert.equal(MerkleTree.verifyProof("not-hex", proof, tree.root), false);
    assert.equal(MerkleTree.verifyProof(hashes[0], [{ position: "right", hash: "zz" }], tree.root), false);
});

test("rejects non-hex hashes", () => {
    assert.throws(() => new MerkleTree(["not-hex"]));
    assert.throws(() => new MerkleTree(["abc"])); // odd length
});
