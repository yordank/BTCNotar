// Generates spec/test-vectors.json from the JS reference implementation.
// Run: node spec/generate-vectors.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MerkleTree, sha256Hex, encodeOpReturnPayload, buildOpReturnScript } from "../packages/btcnotar/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const hex = (u8) => Buffer.from(u8).toString("hex");

const texts = ["", "Hello, Bitcoin!", "Здравей, Биткойн!"];
const sha256 = texts.map((text) => ({ text, utf8Hex: Buffer.from(text, "utf8").toString("hex"), sha256: sha256Hex(text) }));

const sizes = [1, 2, 3, 4, 5, 7, 8, 13];
const trees = sizes.map((n) => {
    const hashes = Array.from({ length: n }, (_, i) => sha256Hex(`btcnotar vector ${n} ${i}`));
    const tree = new MerkleTree(hashes);
    const payload = encodeOpReturnPayload(tree.root);
    return {
        leaves: n,
        hashes,
        merkleRoot: tree.root,
        proofs: hashes.map((_, i) => tree.getProof(i)),
        opReturnPayload: hex(payload),
        opReturnScript: hex(buildOpReturnScript(payload)),
    };
});

// Proofs that must be REJECTED. Each one is checked against "merkleRoot".
const t3 = trees.find((t) => t.leaves === 3);
const p1 = t3.proofs[1];
const invalid = [
    { name: "wrong hash", hash: t3.hashes[0], proof: p1, merkleRoot: t3.merkleRoot },
    { name: "position flipped", hash: t3.hashes[1], proof: p1.map((s) => ({ ...s, position: s.position === "left" ? "right" : "left" })), merkleRoot: t3.merkleRoot },
    { name: "sibling changed", hash: t3.hashes[1], proof: [{ ...p1[0], hash: "00".repeat(32) }, ...p1.slice(1)], merkleRoot: t3.merkleRoot },
    { name: "step missing", hash: t3.hashes[1], proof: p1.slice(0, -1), merkleRoot: t3.merkleRoot },
    {
        // A leaf must never verify as an internal node (domain separation 0x00/0x01).
        name: "internal node used as a leaf",
        hash: new MerkleTree(t3.hashes).layers[1][0].toString("hex"),
        proof: p1.slice(1),
        merkleRoot: t3.merkleRoot,
    },
];

const out = {
    description: "BTCNotar test vectors. Every implementation (JS, Python, Go, Rust, .NET) must pass them. See spec/SPEC.md.",
    version: 1,
    magic: { ascii: "BTN1", hex: Buffer.from("BTN1").toString("hex") },
    merkle: { leaf: "sha256(0x00 || hash)", node: "sha256(0x01 || left || right)", odd: "last node of an odd level is moved up unchanged" },
    sha256,
    trees,
    invalidProofs: invalid,
};

fs.writeFileSync(path.join(here, "test-vectors.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${trees.length} trees, ${invalid.length} invalid proofs`);
