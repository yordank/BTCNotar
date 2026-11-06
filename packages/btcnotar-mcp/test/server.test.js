import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { BTCNotar, MemoryStore, sha256Hex } from "btcnotar";
import { FakeProvider, testWif } from "../../btcnotar/test/helpers.js";

const ENTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

let server, base, notary, chain, dir, client;

// Fake btcnotar server + fake mempool.space API, and the real MCP server over stdio.
before(async () => {
    chain = new FakeProvider();
    notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    server = http.createServer(async (req, res) => {
        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        let raw = "";
        for await (const c of req) raw += c;
        if (req.method === "POST" && req.url === "/api/notary/hash") {
            const { hashHex } = JSON.parse(raw);
            await notary.addHash(hashHex);
            return send(200, await notary.getStatus(hashHex));
        }
        if (req.method === "POST" && req.url === "/api/notary/hashes") {
            const results = [];
            for (const h of JSON.parse(raw).hashes) {
                await notary.addHash(h);
                results.push(await notary.getStatus(h));
            }
            return send(200, { results });
        }
        let m = req.url.match(/^\/api\/notary\/proof\/([0-9a-f]+)$/);
        if (m) {
            const st = await notary.getStatus(m[1]);
            if (!st) return send(404, { error: "not found" });
            return send(st.status === "pending" ? 202 : 200, st);
        }
        m = req.url.match(/^\/mempool\/api\/tx\/([0-9a-f]+)$/);
        if (m) {
            const tx = await chain.fetchTransaction(m[1]);
            if (!tx) return send(404, "Transaction not found");
            return send(200, {
                txid: tx.txid,
                status: { confirmed: true, block_height: tx.blockHeight, block_hash: tx.blockHash, block_time: tx.blockTime },
                vout: tx.vout,
            });
        }
        send(404, { error: "not found" });
    });
    await new Promise((r) => server.listen(0, r));
    base = `http://127.0.0.1:${server.address().port}`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-mcp-"));

    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(
        new StdioClientTransport({
            command: process.execPath,
            args: [ENTRY],
            env: { ...process.env, BTCNOTAR_SERVER: base, BTCNOTAR_MEMPOOL_API: `${base}/mempool/api`, BTCNOTAR_NETWORK: "testnet" },
            stderr: "ignore",
        })
    );
});

after(async () => {
    await client?.close();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

async function call(name, args) {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    const json = text.includes("\n\n") ? JSON.parse(text.slice(text.indexOf("\n\n") + 2)) : null;
    return { isError: !!r.isError, text, json };
}

test("lists the tools with descriptions and schemas", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["check", "hash", "notarize", "notarize_many", "save_proof", "verify_proof_file"]);
    for (const t of tools) {
        assert.ok(t.description.length > 40, t.name);
        assert.equal(t.inputSchema.type, "object");
    }
    assert.equal(tools.find((t) => t.name === "check").annotations.readOnlyHint, true);
    assert.match(client.getInstructions(), /btcnotar/);
});

test("hash: text and file, nothing sent", async () => {
    const f = path.join(dir, "h.txt");
    fs.writeFileSync(f, "abc");
    assert.equal((await call("hash", { text: "abc" })).json.hash, sha256Hex("abc"));
    assert.equal((await call("hash", { file: f })).json.hash, sha256Hex("abc"));
    const bad = await call("hash", { text: "a", file: f });
    assert.equal(bad.isError, true);
    assert.match(bad.text, /exactly one/);
});

test("full flow: notarize file -> check pending -> settle -> check -> save_proof -> verify_proof_file", async () => {
    const doc = path.join(dir, "contract.txt");
    fs.writeFileSync(doc, "agent contract v1");
    const h = sha256Hex("agent contract v1");

    const n = await call("notarize", { file: doc });
    assert.equal(n.isError, false, n.text);
    assert.match(n.text, /Queued/);
    assert.equal(n.json.hash, h);
    assert.equal(n.json.status, "pending");

    const c1 = await call("check", { file: doc });
    assert.match(c1.text, /In the queue/);
    assert.equal(c1.json.reason, "pending");

    const early = await call("save_proof", { file: doc });
    assert.equal(early.isError, true);
    assert.match(early.text, /not anchored yet/);

    await notary.settle();

    const c2 = await call("check", { hash: h });
    assert.match(c2.text, /On the Bitcoin blockchain since block 900000/);
    assert.equal(c2.json.valid, true);

    const s = await call("save_proof", { file: doc });
    assert.equal(s.isError, false, s.text);
    assert.equal(s.json.path, `${doc}.btcnotar.json`);
    assert.ok(fs.existsSync(`${doc}.btcnotar.json`));

    const v = await call("verify_proof_file", { proof_file: `${doc}.btcnotar.json`, document: doc });
    assert.equal(v.json.valid, true, v.text);

    fs.writeFileSync(doc, "agent contract v2");
    const v2 = await call("verify_proof_file", { proof_file: `${doc}.btcnotar.json`, document: doc });
    assert.match(v2.text, /document was changed/);
    assert.equal(v2.json.reason, "document-hash-mismatch");
});

test("notarize again: already notarized", async () => {
    await call("notarize", { text: "twice" });
    await notary.settle();
    const r = await call("notarize", { text: "twice" });
    assert.match(r.text, /Already notarized/);
});

test("notarize_many: texts + hashes + files, order kept, bad item reported", async () => {
    const f = path.join(dir, "many.txt");
    fs.writeFileSync(f, "file in batch");
    const r = await call("notarize_many", { texts: ["m1", "m2"], hashes: [sha256Hex("m3"), "nope"], files: [f] });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /Sent 4 of 5\. 1 failed/);
    assert.equal(r.json[0].text, "m1");
    assert.equal(r.json[0].status, "pending");
    assert.match(r.json[3].error, /64 hex/);
    assert.equal(r.json[4].file, f);
    assert.equal(r.json[4].hash, sha256Hex("file in batch"));
    assert.equal((await call("notarize_many", {})).isError, true);
});

test("errors are returned as tool errors, not crashes", async () => {
    assert.equal((await call("check", { hash: "xyz" })).isError, true);
    assert.equal((await call("check", { file: path.join(dir, "missing.pdf") })).isError, true);
    assert.equal((await call("verify_proof_file", { proof_file: path.join(dir, "missing.json") })).isError, true);
    const unknown = await call("check", { text: "never sent" });
    assert.match(unknown.text, /Not notarized yet/);
});
