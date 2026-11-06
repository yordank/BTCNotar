"""Command line: python -m btcnotar  (or: btcnotar)"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

from .client import BTCNotarClient
from .core import sha256_file, sha256_hex
from .net import MempoolProvider
from .prooffile import verify_proof_file

HELP = """Free public server (no key, no bitcoin needed):
  btcnotar submit <hash|text>   send a hash to the server queue (text is hashed)
  btcnotar check  <hash|text>   get the proof and verify it on the blockchain
  btcnotar wait   <hash|text>   wait until it is on the blockchain
  btcnotar save   <hash|text> [-o out.json]   save the proof file
  Instead of <hash|text> you can use --file <path>.

Verify a saved proof file (no server, only the blockchain):
  btcnotar verify-file <proof.json> [--doc <document>]

Environment: BTCNOTAR_SERVER, BTCNOTAR_NETWORK (mainnet/testnet), BTCNOTAR_MEMPOOL_API
"""


def _print(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False))


def _provider(network):
    api = os.environ.get("BTCNOTAR_MEMPOOL_API")
    return MempoolProvider(network=network, api_base=api) if api else None


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="btcnotar", description="Bitcoin notarization (btcnotar)", epilog=HELP,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["submit", "check", "wait", "save", "verify-file"])
    parser.add_argument("input", nargs="*", help="text, hash, or proof file (verify-file)")
    parser.add_argument("--file", help="hash this file")
    parser.add_argument("--doc", help="verify-file: the original document")
    parser.add_argument("-o", "--out", help="save: output file")
    parser.add_argument("--server", default=os.environ.get("BTCNOTAR_SERVER"))
    args = parser.parse_args(argv)
    network = os.environ.get("BTCNOTAR_NETWORK", "mainnet")

    try:
        if args.command == "verify-file":
            if not args.input:
                parser.error("verify-file needs a proof file")
            out = verify_proof_file(args.input[0], file=args.doc, provider=_provider(network))
            _print(out)
            return 0 if out.get("valid") else 1

        if args.file:
            h = sha256_file(args.file)
            print(f"SHA-256: {h}")
        else:
            text = " ".join(args.input)
            if not text:
                parser.error("give a text, a hash or --file")
            h = text.lower() if re.fullmatch(r"[0-9a-fA-F]{64}", text) else sha256_hex(text)
            if h != text.lower():
                print(f"SHA-256: {h}")

        kwargs = {"network": network}
        if args.server:
            kwargs["server_url"] = args.server
        if _provider(network):
            kwargs["provider"] = _provider(network)
        client = BTCNotarClient(**kwargs)

        if args.command == "submit":
            _print(client.submit(h))
            return 0
        if args.command == "check":
            out = client.verify(h)
            _print(out)
            return 0 if out.get("valid") else 1
        if args.command == "wait":
            def upd(u):
                if u["status"] == "pending":
                    print(f"pending, next settle: {u.get('nextSettleAt')}", file=sys.stderr)
                else:
                    print(f"in tx {u.get('txid')}, waiting for a block", file=sys.stderr)
            rec = client.wait_for_proof(h, on_update=upd)
            print(f"On the blockchain: tx {rec['txid']}")
            return 0
        # save
        target = args.out or (f"{args.file}.btcnotar.json" if args.file else f"{h}.btcnotar.json")
        pf = client.save_proof(h, target)
        print(f"Saved proof to {target} (tx {pf['txid']})")
        return 0
    except Exception as e:  # noqa: BLE001
        print(str(e), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
