import json
import pathlib
import unittest

from btcnotar import (
    MerkleTree,
    build_op_return_script,
    decode_op_return_payload,
    encode_op_return_payload,
    extract_op_return_data,
    sha256_hex,
)

VECTORS = json.loads((pathlib.Path(__file__).resolve().parents[3] / "spec" / "test-vectors.json").read_text("utf-8"))


class VectorTests(unittest.TestCase):
    def test_sha256(self):
        for c in VECTORS["sha256"]:
            self.assertEqual(c["text"].encode("utf-8").hex(), c["utf8Hex"])
            self.assertEqual(sha256_hex(c["text"]), c["sha256"])

    def test_trees(self):
        for t in VECTORS["trees"]:
            tree = MerkleTree(t["hashes"])
            self.assertEqual(tree.root, t["merkleRoot"], f"{t['leaves']} leaves")
            for i, h in enumerate(t["hashes"]):
                self.assertEqual(tree.get_proof(i), t["proofs"][i])
                self.assertTrue(MerkleTree.verify_proof(h, t["proofs"][i], t["merkleRoot"]))
            payload = encode_op_return_payload(t["merkleRoot"])
            self.assertEqual(payload.hex(), t["opReturnPayload"])
            self.assertEqual(build_op_return_script(payload).hex(), t["opReturnScript"])
            self.assertEqual(decode_op_return_payload(payload), t["merkleRoot"])
            self.assertEqual(extract_op_return_data({"vout": [{"scriptpubkey": t["opReturnScript"]}]}), t["merkleRoot"])

    def test_invalid_proofs(self):
        self.assertGreaterEqual(len(VECTORS["invalidProofs"]), 5)
        for c in VECTORS["invalidProofs"]:
            self.assertFalse(MerkleTree.verify_proof(c["hash"], c["proof"], c["merkleRoot"]), c["name"])


if __name__ == "__main__":
    unittest.main()
