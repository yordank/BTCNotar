"""Hashing, Merkle tree, OP_RETURN format and verification. No dependencies.

Same rules as the JS reference — see spec/SPEC.md in the repository.
"""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Iterable, Optional, Union

HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAGIC = b"BTN1"
OP_RETURN_MAX_BYTES = 80

_LEAF = b"\x00"
_NODE = b"\x01"


def sha256_hex(data: Union[str, bytes, bytearray]) -> str:
    """SHA-256 of a string (UTF-8) or bytes, as hex."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def sha256_file(path, chunk_size: int = 1024 * 1024) -> str:
    """SHA-256 of a file, read in chunks (works for big files)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(chunk_size), b""):
            h.update(chunk)
    return h.hexdigest()


def check_hash(hash_hex) -> str:
    """Return the hash in lower case, or raise ValueError if it is not 64 hex chars."""
    h = str(hash_hex or "").strip().lower() if isinstance(hash_hex, str) else ""
    if not HEX64.match(h):
        raise ValueError(f'hash must be 64 hex chars (SHA-256), got "{hash_hex}"')
    return h


def _sha(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


def _from_hex(h: str) -> bytes:
    if not isinstance(h, str) or not re.fullmatch(r"(?:[0-9a-fA-F]{2})+", h):
        raise ValueError(f'invalid hex: "{h}"')
    return bytes.fromhex(h)


def _leaf(hash_hex: str) -> bytes:
    return _sha(_LEAF + _from_hex(hash_hex))


def _node(left: bytes, right: bytes) -> bytes:
    return _sha(_NODE + left + right)


class MerkleTree:
    """Merkle tree over document hashes (hex).

    leaf = sha256(0x00 || h), node = sha256(0x01 || l || r),
    the last item of an odd level is moved up unchanged.
    """

    def __init__(self, hashes: Iterable[str]):
        self.leaves = [h.lower() for h in hashes]
        if not self.leaves:
            raise ValueError("MerkleTree needs at least one hash")
        level = [_leaf(h) for h in self.leaves]
        self.layers = [level]
        while len(level) > 1:
            nxt = []
            for i in range(0, len(level), 2):
                nxt.append(_node(level[i], level[i + 1]) if i + 1 < len(level) else level[i])
            self.layers.append(nxt)
            level = nxt

    @property
    def root(self) -> str:
        return self.layers[-1][0].hex()

    def get_proof(self, index: int) -> list:
        if not isinstance(index, int) or index < 0 or index >= len(self.leaves):
            raise IndexError(f"index out of range: {index}")
        proof, idx = [], index
        for layer in self.layers[:-1]:
            right = idx % 2 == 1
            sib = idx - 1 if right else idx + 1
            if sib < len(layer):
                proof.append({"position": "left" if right else "right", "hash": layer[sib].hex()})
            idx //= 2
        return proof

    def get_proof_for_hash(self, hash_hex: str) -> list:
        return self.get_proof(self.leaves.index(hash_hex.lower()))

    @staticmethod
    def verify_proof(hash_hex: str, proof: list, root_hex: str) -> bool:
        try:
            x = _leaf(hash_hex)
            for step in proof:
                sib = _from_hex(step["hash"])
                if step["position"] == "left":
                    x = _node(sib, x)
                elif step["position"] == "right":
                    x = _node(x, sib)
                else:
                    return False
            return x.hex() == str(root_hex).lower()
        except Exception:
            return False


def encode_op_return_payload(merkle_root_hex: str) -> bytes:
    root = bytes.fromhex(merkle_root_hex)
    if len(root) != 32:
        raise ValueError("merkle root must be 32 bytes")
    return MAGIC + root


def decode_op_return_payload(payload: bytes) -> Optional[str]:
    if not isinstance(payload, (bytes, bytearray)) or len(payload) != len(MAGIC) + 32:
        return None
    if bytes(payload[: len(MAGIC)]) != MAGIC:
        return None
    return bytes(payload[len(MAGIC):]).hex()


def build_op_return_script(data: bytes) -> bytes:
    if len(data) > OP_RETURN_MAX_BYTES:
        raise ValueError("OP_RETURN > 80 bytes")
    if len(data) <= 0x4B:
        push = bytes([len(data)])
    else:
        push = b"\x4c" + bytes([len(data)])
    return b"\x6a" + push + data


def script_pushes(script: bytes) -> Optional[list]:
    """Data pushes of a script. None if the script is broken."""
    out, i = [], 0
    while i < len(script):
        op = script[i]
        i += 1
        if 0x01 <= op <= 0x4B:
            n = op
        elif op == 0x4C:
            if i + 1 > len(script):
                return None
            n = script[i]
            i += 1
        elif op == 0x4D:
            if i + 2 > len(script):
                return None
            n = int.from_bytes(script[i:i + 2], "little")
            i += 2
        elif op == 0x4E:
            if i + 4 > len(script):
                return None
            n = int.from_bytes(script[i:i + 4], "little")
            i += 4
        else:
            continue
        if i + n > len(script):
            return None
        out.append(script[i:i + n])
        i += n
    return out


def extract_op_return_data(tx: dict) -> Optional[str]:
    """Find the BTN1 Merkle root in a transaction's OP_RETURN outputs."""
    for out in tx.get("vout") or []:
        s = out.get("scriptpubkey") or ""
        if not s.startswith("6a"):
            continue
        try:
            pushes = script_pushes(bytes.fromhex(s[2:])) or []
        except ValueError:
            continue
        for data in pushes:
            root = decode_op_return_payload(data)
            if root:
                return root
    return None


def _iso(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def verify_proof(hash_hex: str, record: Optional[dict], provider) -> dict:
    """Verify a proof record against the chain. Trusts nobody.

    record: {merkleRoot, proof, txid}; provider: has fetch_transaction(txid).
    """
    h = str(hash_hex).lower()
    if not record or not record.get("merkleRoot") or not record.get("txid") or not isinstance(record.get("proof"), list):
        return {"valid": False, "reason": "no-proof-found"}
    if not MerkleTree.verify_proof(h, record["proof"], record["merkleRoot"]):
        return {"valid": False, "reason": "merkle-proof-mismatch"}
    tx = provider.fetch_transaction(record["txid"])
    if not tx:
        return {"valid": False, "reason": "transaction-not-found", "txid": record["txid"]}
    root = extract_op_return_data(tx)
    if not root or root != record["merkleRoot"]:
        return {"valid": False, "reason": "on-chain-data-mismatch", "txid": record["txid"]}
    return {
        "valid": True,
        "confirmed": bool(tx.get("confirmed")),
        "txid": record["txid"],
        "merkleRoot": record["merkleRoot"],
        "blockHeight": tx.get("blockHeight"),
        "blockHash": tx.get("blockHash"),
        "blockTime": tx.get("blockTime"),
        "date": _iso(tx.get("blockTime")),
    }
