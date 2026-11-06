import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BTCNotar } from "../src/notary.js";
import { BTCNotarClient, sha256Hex, sha256File } from "../src/client.js";
import { MemoryStore } from "../src/store.js";
import { FakeProvider, testWif } from "./helpers.js";

test("sha256File = sha256Hex of the content (also big files)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "btcnotar-"));
    try {
        const small = path.join(dir, "a.txt");
        fs.writeFileSync(small, "botev12");
        assert.equal(await sha256File(small), sha256Hex("botev12"));

        const big = path.join(dir, "big.bin");
        const data = Buffer.alloc(5 * 1024 * 1024, 7); // bigger than one stream chunk
        fs.writeFileSync(big, data);
        assert.equal(await sha256File(big), sha256Hex(data));

        await assert.rejects(() => sha256File(path.join(dir, "missing")), /ENOENT/);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

// Server like the web app. withBatchRoute=false = old server.
function startServer(notary, { withBatchRoute = true } = {}) {
    const calls = { single: 0, batch: 0 };
    const server = http.createServer(async (req, res) => {
        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        let raw = "";
        for await (const c of req) raw += c;
        if (req.method === "POST" && req.url === "/api/notary/hash") {
            calls.single++;
            const { hashHex } = JSON.parse(raw);
            await notary.addHash(hashHex);
            return send(200, await notary.getStatus(hashHex));
        }
        if (withBatchRoute && req.method === "POST" && req.url === "/api/notary/hashes") {
            calls.batch++;
            const { hashes } = JSON.parse(raw);
            const results = [];
            for (const h of hashes) {
                await notary.addHash(h);
                results.push(await notary.getStatus(h));
            }
            return send(200, { results });
        }
        send(404, { error: "not found" });
    });
    return new Promise((resolve) => server.listen(0, () => resolve({ server, calls })));
}

for (const withBatchRoute of [true, false]) {
    test(`submitMany (${withBatchRoute ? "batch route" : "old server, one by one"})`, async () => {
        const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: new FakeProvider() });
        const { server, calls } = await startServer(notary, { withBatchRoute });
        const client = new BTCNotarClient({ serverUrl: `http://127.0.0.1:${server.address().port}` });
        try {
            const hashes = Array.from({ length: 150 }, (_, i) => sha256Hex(`doc ${i}`));
            const input = [hashes[0], "bad hash", ...hashes.slice(1)];
            const out = await client.submitMany(input);

            assert.equal(out.length, input.length);
            assert.equal(out[0].hash, hashes[0]);
            assert.equal(out[0].status, "pending");
            assert.match(out[1].error, /64 hex/);
            assert.equal(out[150].hash, hashes[149], "order is kept");
            assert.equal(await notary.pendingCount(), 150);
            if (withBatchRoute) assert.deepEqual(calls, { single: 0, batch: 2 }, "151 items -> 2 requests");
            else assert.equal(calls.single, 150);
        } finally {
            server.close();
        }
    });
}

test("submitMany needs an array", async () => {
    await assert.rejects(() => new BTCNotarClient().submitMany("x"), /array/);
});
