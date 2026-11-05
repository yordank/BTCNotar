import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BTCNotar } from "../src/notary.js";
import { BTCNotarClient, sha256Hex } from "../src/client.js";
import { MemoryStore } from "../src/store.js";
import { verifyProofFile, readProofFile, toProofFile, PROOF_FORMAT } from "../src/prooffile.js";
import { FakeProvider, testWif } from "./helpers.js";

function tmpDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-"));
}

// Same routes as the web app.
function startServer(notary) {
    const server = http.createServer(async (req, res) => {
        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if (req.method === "POST" && req.url === "/api/notary/hash") {
            let raw = "";
            for await (const c of req) raw += c;
            const { hashHex } = JSON.parse(raw);
            await notary.addHash(hashHex);
            return send(200, await notary.getStatus(hashHex));
        }
        const m = req.url.match(/^\/api\/notary\/proof\/([0-9a-f]+)$/);
        if (m) {
            const st = await notary.getStatus(m[1]);
            if (!st) return send(404, { error: "not found" });
            return send(st.status === "pending" ? 202 : 200, st);
        }
        send(404, {});
    });
    return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

async function setup() {
    const chain = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    const server = await startServer(notary);
    const client = new BTCNotarClient({ serverUrl: `http://127.0.0.1:${server.address().port}`, network: "testnet", provider: chain });
    return { chain, notary, server, client };
}

test("saveProof writes a file that verifies WITHOUT the server", async () => {
    const { chain, notary, server, client } = await setup();
    const dir = tmpDir();
    const doc = path.join(dir, "contract.txt");
    fs.writeFileSync(doc, "botev12 contract");
    const hash = sha256Hex(fs.readFileSync(doc));
    const out = path.join(dir, "contract.txt.btcnotar.json");

    try {
        await client.submit(hash);
        await notary.settle();
        const pf = await client.saveProof(hash, out);
        assert.equal(pf.format, PROOF_FORMAT);
        assert.equal(pf.network, "testnet");
        assert.equal(pf.blockHeight, 900000, "block info filled from the chain");
    } finally {
        server.close();
    }

    // Server is closed now: only the file + chain are used.
    const saved = readProofFile(out);
    assert.equal(saved.hash, hash);

    const r = await verifyProofFile(out, { file: doc, provider: chain });
    assert.equal(r.valid, true);
    assert.equal(r.confirmed, true);
    assert.equal(r.blockHeight, 900000);
});

test("verifyProofFile: changed document -> document-hash-mismatch", async () => {
    const { chain, notary, server, client } = await setup();
    const hash = sha256Hex("original");
    try {
        await client.submit(hash);
        await notary.settle();
        const pf = await client.downloadProof(hash);
        const r = await verifyProofFile(pf, { file: Buffer.from("original!"), provider: chain });
        assert.equal(r.valid, false);
        assert.equal(r.reason, "document-hash-mismatch");
        assert.equal((await verifyProofFile(pf, { hash, provider: chain })).valid, true);
    } finally {
        server.close();
    }
});

test("verifyProofFile: edited proof file is rejected", async () => {
    const { chain, notary, server } = await setup();
    server.close();
    const h = sha256Hex("doc A");
    await notary.anchorNow(h);
    const pf = await notary.exportProof(h);

    const forged = { ...pf, hash: sha256Hex("doc B") };
    assert.equal((await verifyProofFile(forged, { provider: chain })).reason, "merkle-proof-mismatch");

    const otherTx = { ...pf, txid: "a".repeat(64) };
    assert.equal((await verifyProofFile(otherTx, { provider: chain })).reason, "transaction-not-found");
});

test("verifyProofFile rejects files that are not btcnotar proofs", async () => {
    await assert.rejects(() => verifyProofFile({ hello: 1 }), /not a btcnotar proof file/);
    await assert.rejects(() => verifyProofFile({ format: PROOF_FORMAT, version: 99 }), /unsupported/);
});

test("downloadProof throws while pending, and for unknown hashes", async () => {
    const { server, client } = await setup();
    try {
        const h = sha256Hex("waiting");
        await client.submit(h);
        await assert.rejects(() => client.downloadProof(h), /not anchored yet/);
        await assert.rejects(() => client.downloadProof(sha256Hex("never")), /does not know/);
    } finally {
        server.close();
    }
});

test("waitForProof returns after settlement", async () => {
    const { notary, server, client } = await setup();
    try {
        const h = sha256Hex("wait for me");
        await client.submit(h);
        const updates = [];
        setTimeout(() => notary.settle(), 50);
        const record = await client.waitForProof(h, { intervalMs: 20, timeoutMs: 5000, confirmed: true, onUpdate: (u) => updates.push(u.status) });
        assert.ok(record.txid);
        assert.equal(record.blockHeight, 900000);
        assert.ok(updates.includes("pending"));
    } finally {
        server.close();
    }
});

test("waitForProof: timeout and unknown hash", async () => {
    const { server, client } = await setup();
    try {
        const h = sha256Hex("slow");
        await client.submit(h);
        await assert.rejects(() => client.waitForProof(h, { intervalMs: 10, timeoutMs: 50 }), /timeout/);
        await assert.rejects(() => client.waitForProof(sha256Hex("nope"), { intervalMs: 10 }), /submit it first/);
    } finally {
        server.close();
    }
});

test("notary.saveProof works for own notary too", async () => {
    const { chain, notary, server } = await setup();
    server.close();
    const h = sha256Hex("own notary doc");
    await notary.anchorNow(h);
    const out = path.join(tmpDir(), "p.json");
    await notary.saveProof(h, out);
    assert.equal((await verifyProofFile(out, { hash: h, provider: chain })).valid, true);
    assert.throws(() => toProofFile({ status: "pending" }), /not an anchored/);
});
