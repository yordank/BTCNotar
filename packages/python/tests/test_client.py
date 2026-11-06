import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from btcnotar import BTCNotarClient, MempoolProvider, read_proof_file, sha256_file, sha256_hex, verify_proof_file
from fakes import FakeWorld, start

SRC = str(Path(__file__).resolve().parents[1] / "src")


class ClientTests(unittest.TestCase):
    def setUp(self):
        self.world = FakeWorld()
        self.srv, self.base = start(self.world)
        self.chain = MempoolProvider(api_base=f"{self.base}/mempool/api")
        self.client = BTCNotarClient(server_url=self.base, provider=self.chain)
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.tmp.cleanup()

    def test_submit_pending_settle_verify(self):
        h = sha256_hex("botev12")
        self.assertEqual(self.client.submit(h)["status"], "pending")
        self.assertEqual(self.client.verify(h)["reason"], "pending")
        self.world.settle()
        r = self.client.verify(h)
        self.assertTrue(r["valid"])
        self.assertTrue(r["confirmed"])
        self.assertEqual(r["blockHeight"], 900000)
        self.assertEqual(r["date"], "2025-06-15T15:06:40.000Z")
        self.assertEqual(self.client.verify(sha256_hex("never"))["reason"], "unknown-hash")

    def test_lying_server(self):
        h = sha256_hex("real")
        self.client.submit(h)
        self.world.settle()
        fake = sha256_hex("forged")
        self.world.batches[fake] = {**self.world.batches[h], "hash": fake}
        self.assertEqual(self.client.verify(fake)["reason"], "merkle-proof-mismatch")

    def test_bad_hash(self):
        with self.assertRaises(ValueError):
            self.client.submit("abc")

    def test_submit_many_both_servers(self):
        for batch_route in (True, False):
            self.world.batch_route = batch_route
            hashes = [sha256_hex(f"{batch_route} {i}") for i in range(120)]
            out = self.client.submit_many([hashes[0], "bad", *hashes[1:]])
            self.assertEqual(len(out), 121)
            self.assertEqual(out[0]["hash"], hashes[0])
            self.assertIn("64 hex", out[1]["error"])
            self.assertEqual(out[120]["hash"], hashes[119])

    def test_save_and_verify_file_without_server(self):
        doc = self.dir / "contract.txt"
        doc.write_text("contract v1")
        h = sha256_file(doc)
        self.client.submit(h)
        with self.assertRaises(LookupError):
            self.client.download_proof(h)
        self.world.settle()
        out = self.dir / "contract.txt.btcnotar.json"
        pf = self.client.save_proof(h, out)
        self.assertEqual(pf["blockHeight"], 900000)
        self.assertEqual(read_proof_file(out)["hash"], h)

        self.world.batches.clear()  # server forgets everything
        r = verify_proof_file(out, file=doc, provider=self.chain)
        self.assertTrue(r["valid"])
        doc.write_text("contract v2")
        self.assertEqual(verify_proof_file(out, file=doc, provider=self.chain)["reason"], "document-hash-mismatch")
        with self.assertRaises(ValueError):
            verify_proof_file({"hello": 1})

    def test_wait_for_proof(self):
        h = sha256_hex("wait")
        self.client.submit(h)
        with self.assertRaises(TimeoutError):
            self.client.wait_for_proof(h, interval=0.01, timeout=0.05)
        self.world.settle()
        self.assertEqual(self.client.wait_for_proof(h, interval=0.01, confirmed=True)["blockHeight"], 900000)
        with self.assertRaises(LookupError):
            self.client.wait_for_proof(sha256_hex("nope"), interval=0.01)

    def test_unconfirmed(self):
        self.world.confirmed = False
        h = sha256_hex("mempool")
        self.client.submit(h)
        self.world.settle()
        r = self.client.verify(h)
        self.assertTrue(r["valid"])
        self.assertFalse(r["confirmed"])
        self.assertIsNone(r["date"])

    def test_js_proof_file_is_compatible(self):
        """A proof file written by the JS library must verify in Python (same format)."""
        h = sha256_hex("from js")
        self.client.submit(h)
        self.world.settle()
        rec = self.world.batches[h]
        js_file = {"format": "btcnotar-proof", "version": 1, "hash": h, "merkleRoot": rec["merkleRoot"],
                   "proof": rec["proof"], "txid": rec["txid"], "network": "mainnet", "blockHeight": None,
                   "blockHash": None, "blockTime": None, "date": None, "server": None, "savedAt": "2026-11-06T00:00:00.000Z"}
        self.assertTrue(verify_proof_file(js_file, hash=h, provider=self.chain)["valid"])

    def test_cli(self):
        env = {**os.environ, "PYTHONPATH": SRC, "BTCNOTAR_SERVER": self.base, "BTCNOTAR_MEMPOOL_API": f"{self.base}/mempool/api"}

        def cli(*args):
            return subprocess.run([sys.executable, "-m", "btcnotar", *args], env=env, cwd=self.dir, capture_output=True, text=True)

        doc = self.dir / "doc.txt"
        doc.write_text("cli doc")
        self.assertEqual(cli("submit", "--file", str(doc)).returncode, 0)
        self.assertEqual(cli("check", "--file", str(doc)).returncode, 1)
        self.world.settle()
        r = cli("check", "--file", str(doc))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"valid": true', r.stdout)
        self.assertEqual(cli("save", "--file", str(doc)).returncode, 0)
        r = cli("verify-file", str(doc) + ".btcnotar.json", "--doc", str(doc))
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(json.loads(r.stdout)["blockHeight"], 900000)


if __name__ == "__main__":
    unittest.main()
