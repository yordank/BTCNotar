"""A fake BTCNotar server + fake mempool API in one local HTTP server."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from btcnotar import MerkleTree, build_op_return_script, encode_op_return_payload, sha256_hex


class FakeWorld:
    """Queue, batches and a chain with transactions."""

    def __init__(self):
        self.pending = []
        self.batches = {}  # hash -> record
        self.txs = {}  # txid -> mempool-style tx
        self.batch_route = True
        self.confirmed = True

    def add(self, h):
        if h in self.batches:
            return {"status": "anchored", **self.batches[h]}
        if h not in self.pending:
            self.pending.append(h)
        return {"status": "pending", "hash": h, "addedAt": "2026-11-06T10:00:00.000Z", "nextSettleAt": "2026-11-06T11:00:00.000Z"}

    def settle(self):
        tree = MerkleTree(self.pending)
        txid = sha256_hex("tx " + tree.root)
        self.txs[txid] = {
            "txid": txid,
            "status": {"confirmed": self.confirmed, "block_height": 900000 if self.confirmed else None,
                       "block_hash": "b" * 64 if self.confirmed else None, "block_time": 1750000000 if self.confirmed else None},
            "vout": [{"scriptpubkey": build_op_return_script(encode_op_return_payload(tree.root)).hex(), "value": 0}],
        }
        for i, h in enumerate(self.pending):
            self.batches[h] = {"hash": h, "merkleRoot": tree.root, "proof": tree.get_proof(i), "txid": txid,
                               "blockHeight": None, "blockHash": None, "blockTime": None}
        self.pending = []
        return txid

    def status(self, h):
        if h in self.batches:
            return 200, {"status": "anchored", **self.batches[h]}
        if h in self.pending:
            return 202, self.add(h)
        return 404, {"error": "not found"}


def start(world):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body):
            data = json.dumps(body).encode() if not isinstance(body, str) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json" if not isinstance(body, str) else "text/plain")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            if self.path == "/api/notary/hash":
                return self._send(200, world.add(body["hashHex"]))
            if self.path == "/api/notary/hashes" and world.batch_route:
                return self._send(200, {"results": [world.add(h) for h in body["hashes"]]})
            self._send(404, {"error": "not found"})

        def do_GET(self):
            if self.path.startswith("/api/notary/proof/"):
                return self._send(*world.status(self.path.rsplit("/", 1)[1]))
            if self.path.startswith("/mempool/api/tx/"):
                tx = world.txs.get(self.path.rsplit("/", 1)[1])
                return self._send(200, tx) if tx else self._send(404, "Transaction not found")
            self._send(404, {"error": "not found"})

    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"
