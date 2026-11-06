# btcnotar (Python)

**Prove that a text or a file existed at a certain time — using the Bitcoin blockchain.**

- **Free.** No Bitcoin, no wallet, no key. The public server pays the fee.
- **Private.** Only the SHA-256 hash is sent. Your file never leaves your computer.
- **Trustless.** `verify()` checks the proof directly on the blockchain, not on our server.
- **No dependencies.** Only the Python standard library (3.8+).

```bash
pip install btcnotar
```

Same format as the JavaScript package [`btcnotar`](https://www.npmjs.com/package/btcnotar).
A proof made with one works with the other. Rules: [spec/SPEC.md](https://github.com/yordank/BTCNotar/blob/main/spec/SPEC.md).

---

## Examples

### Notarize a text

```python
from btcnotar import BTCNotarClient, sha256_hex

client = BTCNotarClient()
print(client.submit(sha256_hex("Hello, Bitcoin!")))
# {'status': 'pending', 'hash': '...', 'nextSettleAt': '...'}
```

`pending` = your hash is in the queue. It goes on the blockchain at `nextSettleAt` (about 1 hour).

### Check it later

```python
r = client.verify(sha256_hex("Hello, Bitcoin!"))
if r["valid"]:
    print("On the blockchain:", r["date"], "block", r["blockHeight"])
else:
    print("Not yet:", r["reason"])
```

### Notarize a file and keep the proof

```python
from btcnotar import BTCNotarClient, sha256_file, verify_proof_file

client = BTCNotarClient()
h = sha256_file("contract.pdf")

client.submit(h)
client.wait_for_proof(h)                                  # waits ~1 hour
client.save_proof(h, "contract.pdf.btcnotar.json")

# years later — no server needed, only the blockchain:
r = verify_proof_file("contract.pdf.btcnotar.json", file="contract.pdf")
print(r["valid"], r.get("date"))
```

Keep the file **exactly as it is**. If one byte changes, the proof will not match.

### Many hashes

```python
results = client.submit_many([sha256_hex(t) for t in ["one", "two", "three"]])
```

### Command line

```bash
btcnotar submit "Hello, Bitcoin!"
btcnotar check  "Hello, Bitcoin!"
btcnotar submit --file contract.pdf
btcnotar wait   --file contract.pdf
btcnotar save   --file contract.pdf            # -> contract.pdf.btcnotar.json
btcnotar verify-file contract.pdf.btcnotar.json --doc contract.pdf
```

Also works as `python -m btcnotar ...`.

---

## What `verify()` returns

```python
{"valid": True, "confirmed": True, "txid": "...", "blockHeight": 920123, "date": "2026-10-25T15:08:12.000Z", ...}
{"valid": False, "reason": "pending", "nextSettleAt": "..."}
{"valid": False, "reason": "unknown-hash"}
{"valid": False, "reason": "merkle-proof-mismatch"}
{"valid": False, "reason": "on-chain-data-mismatch"}
{"valid": False, "reason": "document-hash-mismatch"}   # verify_proof_file: document changed
```

## API

- `BTCNotarClient(server_url=..., network="mainnet", provider=None, timeout=20)`
  - `submit(hash)`, `submit_many(hashes)`, `get_proof(hash)`, `verify(hash)`
  - `wait_for_proof(hash, interval=60, timeout=10800, confirmed=False, on_update=None)`
  - `download_proof(hash)`, `save_proof(hash, path)`
- `verify_proof_file(path_or_dict, file=None, hash=None, provider=None)`
- `sha256_hex(text_or_bytes)`, `sha256_file(path)`
- `MerkleTree`, `verify_proof`, `MempoolProvider(network, api_base)`, `read_proof_file`, `write_proof_file`

This Python package is a **client**. To run your own notary (with your own Bitcoin key), use the JavaScript package.

## License

MIT
