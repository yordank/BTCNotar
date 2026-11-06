import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BTCNotar } from "../src/notary.js";
import { MemoryStore } from "../src/store.js";
import { FakeProvider, sha256hex, testWif } from "./helpers.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "cli.js");

let server, base, notary, chain, dir;

// One fake server: BTCNotar routes + mempool.space-like /api/tx/:txid.
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
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-cli-"));
});

after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
});

function cli(args, env = {}) {
    return new Promise((resolve) => {
        execFile(
            process.execPath,
            [CLI, ...args],
            {
                cwd: dir,
                env: { ...process.env, BTCNOTAR_SERVER: base, BTCNOTAR_MEMPOOL_API: `${base}/mempool/api`, BTCNOTAR_NETWORK: "testnet", ...env },
            },
            (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })
        );
    });
}

test("cli: help", async () => {
    const r = await cli(["--help"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /verify-file/);
});

test("cli: unknown command -> exit 1", async () => {
    const r = await cli(["dance"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Unknown command/);
});

test("cli: submit text, check before and after settlement", async () => {
    const r = await cli(["submit", "Hello", "CLI"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`SHA-256: ${sha256hex("Hello CLI")}`));
    assert.match(r.stdout, /"status": "pending"/);

    const pending = await cli(["check", "Hello CLI"]);
    assert.equal(pending.code, 1);
    assert.match(pending.stdout, /"reason": "pending"/);

    await notary.settle();
    const ok = await cli(["check", sha256hex("Hello CLI")]);
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /"valid": true/);
});

test("cli: --file submit, wait, save, verify-file (ok and changed document)", async () => {
    const doc = path.join(dir, "contract.txt");
    fs.writeFileSync(doc, "cli contract v1");

    assert.equal((await cli(["submit", "--file", doc])).code, 0);
    await notary.settle();

    const w = await cli(["wait", "--file", doc]);
    assert.equal(w.code, 0, w.stderr);
    assert.match(w.stdout, /On the blockchain: tx [0-9a-f]{64}/);

    const s = await cli(["save", "--file", doc]);
    assert.equal(s.code, 0, s.stderr);
    const proofPath = `${doc}.btcnotar.json`;
    assert.ok(fs.existsSync(proofPath));

    const v = await cli(["verify-file", proofPath, "--doc", doc]);
    assert.equal(v.code, 0, v.stdout + v.stderr);
    assert.match(v.stdout, /"valid": true/);

    fs.writeFileSync(doc, "cli contract v2");
    const bad = await cli(["verify-file", proofPath, "--doc", doc]);
    assert.equal(bad.code, 1);
    assert.match(bad.stdout, /document-hash-mismatch/);
});

test("cli: save text to a chosen file name", async () => {
    await cli(["submit", "named"]);
    await notary.settle();
    const r = await cli(["save", "named", "my-proof.json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "my-proof.json"), "utf8")).hash, sha256hex("named"));
});

test("cli: own notary needs BTCNOTAR_WIF; address works with it", async () => {
    const no = await cli(["address"], { BTCNOTAR_WIF: "" });
    assert.equal(no.code, 1);
    assert.match(no.stderr, /BTCNOTAR_WIF/);
    const yes = await cli(["address"], { BTCNOTAR_WIF: testWif() });
    assert.equal(yes.code, 0);
    assert.match(yes.stdout.trim(), /^tb1q[0-9a-z]+$/);
});
