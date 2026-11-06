// End-to-end: the real web app (server.js) with a fake mempool.space API,
// used through its remote MCP endpoint /mcp and the REST API.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { sha256Hex } from "btcnotar";

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ECPair = ECPairFactory(ecc);

let mempool, app, base, dataDir, client;

function listen(server) {
    return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server.address().port)));
}

async function freePort() {
    const s = http.createServer();
    const port = await listen(s);
    await new Promise((r) => s.close(r));
    return port;
}

// Fake mempool.space: one UTXO, fixed fee, accepts any tx and "confirms" it.
function fakeMempool() {
    const txs = new Map();
    return http.createServer(async (req, res) => {
        const json = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        let raw = "";
        for await (const c of req) raw += c;
        if (/^\/api\/address\/[^/]+\/utxo$/.test(req.url)) {
            return json(200, [{ txid: "f".repeat(64), vout: 0, value: 100000, status: { confirmed: true } }]);
        }
        if (req.url === "/api/v1/fees/recommended") return json(200, { halfHourFee: 5 });
        if (req.method === "POST" && req.url === "/api/tx") {
            const tx = bitcoin.Transaction.fromHex(raw.trim());
            txs.set(tx.getId(), tx.outs.map((o) => ({ scriptpubkey: Buffer.from(o.script).toString("hex"), value: Number(o.value) })));
            res.writeHead(200, { "content-type": "text/plain" });
            return res.end(tx.getId());
        }
        const m = req.url.match(/^\/api\/tx\/([0-9a-f]{64})$/);
        if (m) {
            const vout = txs.get(m[1]);
            if (!vout) {
                res.writeHead(404);
                return res.end("Transaction not found");
            }
            return json(200, { txid: m[1], status: { confirmed: true, block_height: 920001, block_hash: "b".repeat(64), block_time: 1762430000 }, vout });
        }
        res.writeHead(404);
        res.end("not found");
    });
}

before(async () => {
    mempool = fakeMempool();
    const mempoolPort = await listen(mempool);
    const port = await freePort();
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-webapp-"));
    const wif = ECPair.makeRandom({ network: bitcoin.networks.bitcoin, rng: (n) => crypto.randomBytes(n) }).toWIF();

    app = spawn(process.execPath, ["server.js"], {
        cwd: APP_DIR,
        env: {
            ...process.env,
            PORT: String(port),
            DATA_DIR: dataDir,
            OPRETURN_WIF_MAINNET: wif,
            NOTARY_MEMPOOL_API: `http://127.0.0.1:${mempoolPort}/api`,
            ADMIN_KEY: "test-admin",
            HASH_RATE_PER_MIN: "4",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    app.stdout.on("data", (d) => (log += d));
    app.stderr.on("data", (d) => (log += d));
    await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("server did not start:\n" + log)), 15000);
        app.stdout.on("data", () => {
            if (log.includes("Server running")) {
                clearTimeout(t);
                resolve();
            }
        });
        app.on("exit", (code) => reject(new Error(`server exited ${code}:\n${log}`)));
    });
    base = `http://127.0.0.1:${port}`;

    client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});

after(async () => {
    await client?.close().catch(() => {});
    app?.kill();
    mempool?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(name, args) {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    const i = text.indexOf("\n\n");
    return { isError: !!r.isError, text, json: i >= 0 ? JSON.parse(text.slice(i + 2)) : null };
}

const settle = () => fetch(`${base}/api/notary/settle`, { method: "POST", headers: { "x-admin-key": "test-admin" } }).then((r) => r.json());

test("remote MCP: tools for remote use (no file paths)", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["check", "get_proof", "hash", "notarize", "notarize_many", "verify_proof"]);
    assert.ok(!JSON.stringify(tools).includes('"file"'), "no file inputs on the remote server");
    assert.match(client.getInstructions(), /cannot read local files/);
});

test("remote MCP: notarize -> check -> settle -> check -> get_proof -> verify_proof", async () => {
    const h = sha256Hex("remote agent text");
    const n = await call("notarize", { text: "remote agent text" });
    assert.equal(n.isError, false, n.text);
    assert.equal(n.json.status, "pending");
    assert.equal(n.json.hash, h);

    assert.equal((await call("check", { hash: h })).json.reason, "pending");
    const early = await call("get_proof", { hash: h });
    assert.equal(early.isError, true);
    assert.match(early.text, /not anchored yet/);

    const batch = await settle();
    assert.ok(batch.txid, JSON.stringify(batch));

    const c = await call("check", { text: "remote agent text" });
    assert.match(c.text, /On the Bitcoin blockchain since block 920001/);

    const p = await call("get_proof", { hash: h });
    assert.equal(p.isError, false, p.text);
    assert.equal(p.json.format, "btcnotar-proof");
    assert.equal(p.json.blockHeight, 920001);
    assert.equal(p.json.server, base);

    const v = await call("verify_proof", { proof: p.json, text: "remote agent text" });
    assert.equal(v.json.valid, true, v.text);
    const wrong = await call("verify_proof", { proof: p.json, text: "another text" });
    assert.equal(wrong.json.reason, "document-hash-mismatch");

    // The same proof file also comes from the REST download
    const rest = await fetch(`${base}/api/notary/prooffile/${h}`);
    assert.equal(rest.status, 200);
    assert.match(rest.headers.get("content-disposition"), /\.btcnotar\.json/);
    assert.equal((await rest.json()).txid, p.json.txid);
});

test("remote MCP: same per-IP limit as the REST API", async () => {
    // limit is 4 new hashes per minute; 1 was used above
    const r = await call("notarize_many", { texts: ["a1", "a2", "a3", "a4", "a5"] });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.json.filter((x) => x.status === "pending").length, 3);
    assert.equal(r.json.filter((x) => /too many requests/.test(x.error || "")).length, 2);

    const rest = await fetch(`${base}/api/notary/hash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashHex: sha256Hex("rest after limit") }),
    });
    assert.equal(rest.status, 429);

    // known hashes are still answered (no limit)
    const known = await fetch(`${base}/api/notary/hash`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hashHex: sha256Hex("a1") }),
    });
    assert.equal(known.status, 200);
});

test("REST: bad hash 400, unknown proof 404; GET /mcp is 405", async () => {
    const bad = await fetch(`${base}/api/notary/hash`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"hashHex":"x"}' });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/notary/prooffile/${sha256Hex("nobody")}`)).status, 404);
    assert.equal((await fetch(`${base}/mcp`)).status, 405);
});
