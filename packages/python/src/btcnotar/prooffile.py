"""Portable proof file: verify later with only the blockchain (no BTCNotar server)."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Optional, Union

from .core import HEX64, _iso, sha256_file, sha256_hex, verify_proof
from .net import MempoolProvider

PROOF_FORMAT = "btcnotar-proof"
PROOF_VERSION = 1


def _now() -> str:
    d = datetime.now(timezone.utc)
    return d.strftime("%Y-%m-%dT%H:%M:%S.") + f"{d.microsecond // 1000:03d}Z"


def to_proof_file(record: dict, network: str = "mainnet", server: Optional[str] = None) -> dict:
    if not record or not record.get("merkleRoot") or not record.get("txid") or not isinstance(record.get("proof"), list):
        raise ValueError("not an anchored proof record (need merkleRoot, txid and proof)")
    return {
        "format": PROOF_FORMAT,
        "version": PROOF_VERSION,
        "hash": str(record["hash"]).lower(),
        "merkleRoot": record["merkleRoot"],
        "proof": record["proof"],
        "txid": record["txid"],
        "network": network,
        "blockHeight": record.get("blockHeight"),
        "blockHash": record.get("blockHash"),
        "blockTime": record.get("blockTime"),
        "date": _iso(record.get("blockTime")),
        "server": server,
        "savedAt": _now(),
    }


def check_proof_file(obj) -> dict:
    if not isinstance(obj, dict) or obj.get("format") != PROOF_FORMAT:
        raise ValueError("not a btcnotar proof file")
    if obj.get("version") != PROOF_VERSION:
        raise ValueError(f"unsupported proof file version: {obj.get('version')}")
    for key in ("hash", "merkleRoot", "txid"):
        if not HEX64.match(str(obj.get(key) or "")):
            raise ValueError(f"proof file: bad {key}")
    if not isinstance(obj.get("proof"), list):
        raise ValueError("proof file: bad proof")
    return obj


def write_proof_file(path, proof_file: dict) -> str:
    check_proof_file(proof_file)
    path = os.fspath(path)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(proof_file, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
    return path


def read_proof_file(path) -> dict:
    with open(path, encoding="utf-8") as f:
        return check_proof_file(json.load(f))


def verify_proof_file(
    proof_file_or_path: Union[str, os.PathLike, dict],
    file: Union[str, os.PathLike, bytes, None] = None,
    hash: Optional[str] = None,
    provider=None,
) -> dict:
    """Verify a proof file against the blockchain. No server is used.

    file: the original document (path or bytes); its SHA-256 must match.
    """
    pf = check_proof_file(proof_file_or_path) if isinstance(proof_file_or_path, dict) else read_proof_file(proof_file_or_path)
    expected = hash.lower() if hash else None
    if file is not None:
        expected = sha256_hex(file) if isinstance(file, (bytes, bytearray)) else sha256_file(file)
    if expected and expected != pf["hash"]:
        return {"valid": False, "reason": "document-hash-mismatch", "hash": pf["hash"], "documentHash": expected}
    chain = provider or MempoolProvider(network=pf.get("network") or "mainnet")
    return {"hash": pf["hash"], **verify_proof(pf["hash"], pf, chain)}
