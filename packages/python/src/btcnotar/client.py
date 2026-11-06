"""Client for a BTCNotar server (free public server by default)."""

from __future__ import annotations

import time
from typing import Callable, Iterable, List, Optional

from .core import check_hash, verify_proof
from .net import HTTPError, MempoolProvider, request
from .prooffile import to_proof_file, write_proof_file

DEFAULT_SERVER_URL = "https://proofofexistance-production.up.railway.app"


class BTCNotarClient:
    """No key and no bitcoin needed: the server anchors your hash and pays the fee.

    verify() does not trust the server: it checks the proof on the blockchain itself.
    """

    def __init__(self, server_url: str = DEFAULT_SERVER_URL, network: str = "mainnet", provider=None, timeout: float = 20.0):
        self.server_url = server_url.rstrip("/")
        self.network = network
        self.provider = provider or MempoolProvider(network=network)
        self.timeout = timeout

    def _call(self, method: str, path: str, body=None):
        return request(method, f"{self.server_url}{path}", body=body, timeout=self.timeout)

    def _raise(self, status, data, path):
        raise HTTPError(status, data, f"{self.server_url}{path}")

    def submit(self, hash_hex: str) -> dict:
        """Add a hash to the server queue."""
        h = check_hash(hash_hex)
        status, data = self._call("POST", "/api/notary/hash", {"hashHex": h})
        if status >= 400:
            self._raise(status, data, "/api/notary/hash")
        return data

    def submit_many(self, hashes: Iterable[str]) -> List[dict]:
        """Send many hashes (100 per request). One result per hash, same order: status or {hash, error}."""
        hashes = list(hashes)
        results: List[dict] = []
        for i in range(0, len(hashes), 100):
            chunk = hashes[i:i + 100]
            valid, slots = [], []
            for h in chunk:
                try:
                    valid.append(check_hash(h))
                    slots.append(len(valid) - 1)
                except ValueError as e:
                    slots.append({"hash": h, "error": str(e)})
            got: list = []
            if valid:
                status, data = self._call("POST", "/api/notary/hashes", {"hashes": valid})
                if status == 404:  # old server
                    for h in valid:
                        try:
                            got.append(self.submit(h))
                        except Exception as e:  # noqa: BLE001
                            got.append({"hash": h, "error": str(e)})
                elif status >= 400:
                    self._raise(status, data, "/api/notary/hashes")
                else:
                    got = data["results"]
            results.extend(got[s] if isinstance(s, int) else s for s in slots)
        return results

    def get_proof(self, hash_hex: str) -> Optional[dict]:
        """Proof record, {"status": "pending", ...} while waiting, or None if unknown."""
        h = check_hash(hash_hex)
        path = f"/api/notary/proof/{h}"
        status, data = self._call("GET", path)
        if status == 404:
            return None
        if status == 202:
            return {**(data or {}), "status": "pending"}
        if status >= 400:
            self._raise(status, data, path)
        return data

    def verify(self, hash_hex: str) -> dict:
        """Get the proof from the server and verify it on the blockchain yourself."""
        h = check_hash(hash_hex)
        record = self.get_proof(h)
        if not record:
            return {"valid": False, "reason": "unknown-hash"}
        if record.get("status") == "pending":
            return {"valid": False, "reason": "pending", "nextSettleAt": record.get("nextSettleAt")}
        return verify_proof(h, record, self.provider)

    def wait_for_proof(
        self,
        hash_hex: str,
        interval: float = 60.0,
        timeout: float = 3 * 60 * 60,
        confirmed: bool = False,
        on_update: Optional[Callable[[dict], None]] = None,
    ) -> dict:
        """Wait until the hash is in a transaction (with confirmed=True: in a block). Returns the proof record."""
        h = check_hash(hash_hex)
        deadline = time.monotonic() + timeout
        while True:
            record = self.get_proof(h)
            if not record:
                raise LookupError(f"server does not know this hash (submit it first): {h}")
            if record.get("status") != "pending":
                if not confirmed:
                    return record
                check = verify_proof(h, record, self.provider)
                if check.get("valid") and check.get("confirmed"):
                    return {**record, "blockHeight": check["blockHeight"], "blockHash": check["blockHash"], "blockTime": check["blockTime"]}
                if on_update:
                    on_update({"status": "unconfirmed", "txid": record.get("txid")})
            elif on_update:
                on_update({"status": "pending", "nextSettleAt": record.get("nextSettleAt")})
            left = deadline - time.monotonic()
            if left <= 0:
                raise TimeoutError(f"timeout: hash not {'confirmed' if confirmed else 'anchored'} yet: {h}")
            time.sleep(min(interval, left))

    def download_proof(self, hash_hex: str) -> dict:
        """Proof file dict. Keep it next to your document."""
        h = check_hash(hash_hex)
        record = self.get_proof(h)
        if not record:
            raise LookupError(f"server does not know this hash: {h}")
        if record.get("status") == "pending":
            raise LookupError(f"not anchored yet (pending until {record.get('nextSettleAt') or 'next settlement'})")
        full = {**record, "hash": h}
        if not full.get("blockHeight"):
            check = verify_proof(h, full, self.provider)
            if check.get("valid") and check.get("confirmed"):
                full.update(blockHeight=check["blockHeight"], blockHash=check["blockHash"], blockTime=check["blockTime"])
        return to_proof_file(full, network=self.network, server=self.server_url)

    def save_proof(self, hash_hex: str, path) -> dict:
        """Download the proof and save it as JSON."""
        pf = self.download_proof(hash_hex)
        write_proof_file(path, pf)
        return pf
