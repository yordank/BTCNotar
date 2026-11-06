import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { MempoolProvider, httpRequest } from "../src/bitcoin.js";

// Fake mempool.space API.
function startApi() {
    const server = http.createServer(async (req, res) => {
        const json = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        if (req.url === "/api/address/tb1x/utxo") return json(200, [{ txid: "a".repeat(64), vout: 0, value: 1000 }]);
        if (req.url === "/api/v1/fees/recommended") return json(200, { halfHourFee: 7 });
        if (req.url === "/api/tx" && req.method === "POST") {
            let raw = "";
            for await (const c of req) raw += c;
            if (raw === "bad") {
                res.writeHead(400, { "content-type": "text/plain" });
                return res.end("sendrawtransaction RPC error: bad-txns");
            }
            res.writeHead(200, { "content-type": "text/plain" });
            return res.end("b".repeat(64));
        }
        if (req.url === `/api/tx/${"c".repeat(64)}`) {
            return json(200, {
                txid: "c".repeat(64),
                status: { confirmed: true, block_height: 900001, block_hash: "d".repeat(64), block_time: 1750000000 },
                vout: [{ scriptpubkey: "6a", value: 0, extra: 1 }],
            });
        }
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Transaction not found");
    });
    return new Promise((r) => server.listen(0, () => r(server)));
}

test("MempoolProvider works with fetch (utxo, fee, broadcast, tx, 404)", async () => {
    const api = await startApi();
    const p = new MempoolProvider({ apiBase: `http://127.0.0.1:${api.address().port}/api` });
    try {
        assert.equal((await p.fetchUtxos("tb1x"))[0].value, 1000);
        assert.equal(await p.fetchFeeRateSatVb(), 7);
        assert.equal(await p.broadcastTx("00"), "b".repeat(64));

        const tx = await p.fetchTransaction("c".repeat(64));
        assert.deepEqual(tx, {
            txid: "c".repeat(64),
            confirmed: true,
            blockHeight: 900001,
            blockHash: "d".repeat(64),
            blockTime: 1750000000,
            vout: [{ scriptpubkey: "6a", value: 0 }],
        });
        assert.equal(await p.fetchTransaction("e".repeat(64)), null);

        // rejected by the node: error has .response (used to undo the batch)
        const err = await p.broadcastTx("bad").catch((e) => e);
        assert.equal(err.response.status, 400);
        assert.match(err.message, /bad-txns/);
    } finally {
        api.close();
    }
});

test("MempoolProvider: fee falls back to 10 if the API is down; network errors have no .response", async () => {
    const p = new MempoolProvider({ apiBase: "http://127.0.0.1:1/api", timeoutMs: 2000 });
    assert.equal(await p.fetchFeeRateSatVb(), 10);
    const err = await httpRequest("http://127.0.0.1:1/x", { timeoutMs: 2000 }).catch((e) => e);
    assert.ok(err instanceof Error);
    assert.equal(err.response, undefined);
});

test("MempoolProvider default URLs", () => {
    assert.equal(new MempoolProvider().apiBase, "https://mempool.space/api");
    assert.equal(new MempoolProvider({ network: "testnet" }).apiBase, "https://mempool.space/testnet/api");
});
