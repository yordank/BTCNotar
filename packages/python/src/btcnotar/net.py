"""HTTP helpers and the mempool.space provider (urllib only, no dependencies)."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Optional

USER_AGENT = "btcnotar-python"


class HTTPError(Exception):
    """Server answered with an error status. `status` and `data` are set."""

    def __init__(self, status: int, data, url: str):
        self.status = status
        self.data = data
        msg = data.get("error") if isinstance(data, dict) else data
        super().__init__(f"HTTP {status} {url}: {msg}")


def request(method: str, url: str, body=None, timeout: float = 20.0, raw_body: Optional[str] = None):
    """Do a request. Returns (status, data). data = parsed JSON or text. Never raises on HTTP status."""
    headers = {"User-Agent": USER_AGENT}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif raw_body is not None:
        data = raw_body.encode("utf-8")
        headers["Content-Type"] = "text/plain"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            status, text = res.status, res.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        status, text = e.code, e.read().decode("utf-8", "replace")
    try:
        parsed = json.loads(text) if text else None
    except ValueError:
        parsed = text
    return status, parsed


class MempoolProvider:
    """Reads the chain from the mempool.space REST API (or a compatible one)."""

    def __init__(self, network: str = "mainnet", api_base: Optional[str] = None, timeout: float = 20.0):
        self.network = network
        self.api_base = api_base or (
            "https://mempool.space/api" if network == "mainnet" else f"https://mempool.space/{network}/api"
        )
        self.timeout = timeout

    def fetch_transaction(self, txid: str) -> Optional[dict]:
        url = f"{self.api_base}/tx/{txid}"
        status, tx = request("GET", url, timeout=self.timeout)
        if status == 404:
            return None
        if status >= 400 or not isinstance(tx, dict):
            raise HTTPError(status, tx, url)
        st = tx.get("status") or {}
        return {
            "txid": tx.get("txid"),
            "confirmed": bool(st.get("confirmed")),
            "blockHeight": st.get("block_height"),
            "blockHash": st.get("block_hash"),
            "blockTime": st.get("block_time"),
            "vout": [{"scriptpubkey": o.get("scriptpubkey"), "value": o.get("value")} for o in tx.get("vout") or []],
        }
