import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as bitcoin from "bitcoinjs-lib";
import * as light from "../client.js";
import { scriptPushes, extractOpReturnData, encodeOpReturnPayload } from "../src/chain.js";

const hex = (u8) => Buffer.from(u8).toString("hex");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// Follow the relative imports from a file and collect every package it uses.
function packagesUsed(file, seen = new Set(), pkgs = new Set()) {
    if (seen.has(file)) return pkgs;
    seen.add(file);
    const src = fs.readFileSync(file, "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");
    for (const m of src.matchAll(/(?:import|export)[^"']*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
        const spec = m[1] || m[2];
        if (spec.startsWith(".")) packagesUsed(path.resolve(path.dirname(file), spec), seen, pkgs);
        else pkgs.add(spec);
    }
    return pkgs;
}

test("btcnotar/client does not load bitcoinjs-lib / secp256k1", () => {
    const pkgs = [...packagesUsed(path.join(root, "client.js"))];
    assert.ok(pkgs.every((p) => p.startsWith("node:")), `client entry uses: ${pkgs.join(", ")}`);
});

test("btcnotar/client exports the client API", () => {
    for (const name of ["BTCNotarClient", "sha256Hex", "verifyProof", "verifyProofFile", "MerkleTree", "MempoolProvider"]) {
        assert.equal(typeof light[name], "function", name);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    assert.equal(pkg.exports["./client"], "./client.js");
    assert.ok(pkg.files.includes("client.js"));
});

test("scriptPushes reads the same data as bitcoinjs-lib decompile", () => {
    const payload = encodeOpReturnPayload("ab".repeat(32));
    const cases = [
        bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, payload]),
        bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.alloc(76, 7)]), // OP_PUSHDATA1
        bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.alloc(300, 1)]), // OP_PUSHDATA2
        bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, bitcoin.opcodes.OP_1, Buffer.from("hi")]),
    ];
    for (const script of cases) {
        const expected = bitcoin.script.decompile(script).filter((el) => el instanceof Uint8Array).map((el) => Buffer.from(el));
        assert.ok(expected.length > 0);
        assert.deepEqual(scriptPushes(Buffer.from(script).toString("hex").slice(2)), expected);
    }
    assert.equal(scriptPushes("4c"), null, "broken script");
    assert.equal(scriptPushes("05aabb"), null, "push longer than script");
});

test("extractOpReturnData finds the BTN1 root, ignores other OP_RETURNs", () => {
    const rootHex = "cd".repeat(32);
    const ours = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, encodeOpReturnPayload(rootHex)]);
    const other = bitcoin.script.compile([bitcoin.opcodes.OP_RETURN, Buffer.from("not ours")]);
    assert.equal(extractOpReturnData({ vout: [{ scriptpubkey: hex(other) }, { scriptpubkey: hex(ours) }] }), rootHex);
    assert.equal(extractOpReturnData({ vout: [{ scriptpubkey: hex(other) }] }), null);
    assert.equal(extractOpReturnData({ vout: [{ scriptpubkey: "0014" + "00".repeat(20) }] }), null);
    assert.equal(extractOpReturnData({}), null);
});
