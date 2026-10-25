import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { BTCNotar } from "../src/notary.js";
import { BTCNotarClient, sha256Hex } from "../src/client.js";
import { MemoryStore } from "../src/store.js";
import { FakeProvider, testWif } from "./helpers.js";

// Minimal server with the same two routes as the web app.
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

test("client: submit -> pending -> settle -> verify against the chain", async () => {
    const chain = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    const server = await startServer(notary);
    const client = new BTCNotarClient({ serverUrl: `http://127.0.0.1:${server.address().port}`, provider: chain });

    try {
        const h1 = sha256Hex("botev12");
        const h2 = sha256Hex("botevpd1912");

        const s1 = await client.submit(h1);
        await client.submit(h2);
        assert.equal(s1.status, "pending");
        assert.ok(s1.nextSettleAt);

        const before = await client.verify(h1);
        assert.equal(before.valid, false);
        assert.equal(before.reason, "pending");

        await notary.settle(); // what the hourly timer does

        const r1 = await client.verify(h1);
        const r2 = await client.verify(h2);
        assert.equal(r1.valid, true);
        assert.equal(r2.valid, true);
        assert.equal(r1.txid, r2.txid, "both in one transaction");

        assert.equal((await client.verify(sha256Hex("never sent"))).reason, "unknown-hash");
    } finally {
        server.close();
    }
});

test("client: verify does not trust a lying server", async () => {
    const chain = new FakeProvider();
    const notary = new BTCNotar({ wif: testWif(), network: "testnet", store: new MemoryStore(), provider: chain });
    const h = sha256Hex("real doc");
    await notary.anchorNow(h);
    const real = await notary.getStatus(h);

    // Server claims a different hash is in the same batch, using the real proof.
    const fake = sha256Hex("forged doc");
    const liar = http.createServer((req, res) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...real, hash: fake }));
    });
    await new Promise((r) => liar.listen(0, r));
    try {
        const client = new BTCNotarClient({ serverUrl: `http://127.0.0.1:${liar.address().port}`, provider: chain });
        const out = await client.verify(fake);
        assert.equal(out.valid, false);
        assert.equal(out.reason, "merkle-proof-mismatch");
    } finally {
        liar.close();
    }
});

test("client rejects bad hashes before calling the server", async () => {
    const client = new BTCNotarClient({ serverUrl: "http://127.0.0.1:1" });
    await assert.rejects(() => client.submit("botev12"), /64 hex/);
});
