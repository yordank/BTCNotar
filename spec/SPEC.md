# BTCNotar specification — version 1

This is the format every BTCNotar implementation must follow (JS, Python, Go, Rust, .NET).
The JS package `btcnotar` is the reference. Check your code with [`test-vectors.json`](test-vectors.json).

Words: **hash** = SHA-256 of a document, 32 bytes, written as 64 lower-case hex chars.
`||` = join bytes.

---

## 1. Document hash

```
hash = SHA-256(document bytes)
```

Text is hashed as **UTF-8** bytes, with no extra newline.
Hex input is accepted in any case and turned into lower case. Anything that is not exactly 64 hex chars is rejected.

## 2. Merkle tree

All hashes in one batch go into one tree, in the order they were queued.

```
leaf(h)        = SHA-256(0x00 || h)            h = 32 raw bytes
node(l, r)     = SHA-256(0x01 || l || r)
```

Build level by level:

1. Level 0 = `leaf(h)` for every hash.
2. Pair items from the left: `node(item[0], item[1])`, `node(item[2], item[3])`, …
3. If a level has an odd count, the **last item is moved up unchanged** (it is NOT hashed with itself).
4. Repeat until one item is left. That is the **Merkle root**.

The `0x00` / `0x01` prefixes make sure a leaf can never be used as an internal node (and the other way).
Not doubling the last item avoids the CVE-2012-2459 problem of Bitcoin's own block tree.

A tree with 1 hash has root = `leaf(h)`.

## 3. Proof

A proof is a list of steps from the leaf up to the root:

```json
[{ "position": "left", "hash": "<64 hex>" }, { "position": "right", "hash": "<64 hex>" }]
```

`position` says where the **sibling** is. To verify:

```
x = leaf(hash)
for step in proof:
    if step.position == "left":  x = node(step.hash, x)
    else:                        x = node(x, step.hash)
valid = (hex(x) == merkleRoot)
```

A level where the item had no sibling (moved up unchanged) has **no step**.
Any error (bad hex, unknown position) means `valid = false`.

## 4. On the blockchain

One batch = one Bitcoin transaction with one `OP_RETURN` output (value 0):

```
payload = "BTN1" (42544e31) || merkleRoot (32 bytes)      = 36 bytes
script  = 0x6a (OP_RETURN) 0x24 (push 36 bytes) payload
```

`BTN1` = BTCNotar, format version 1. Your hash is not on the chain, only the root.

To read: take every output whose script starts with `0x6a`, read its data pushes
(direct push `0x01`–`0x4b`, `OP_PUSHDATA1/2/4`), and use the first push that is exactly
36 bytes and starts with `BTN1`. The other 32 bytes are the root.

The reference notary sends the transaction from a P2WPKH address, with change back to
the same address, and sets nSequence `0xfffffffd` (Replace-By-Fee). This is not needed for verifying.

## 5. Verify

Input: `hash` and a proof record `{ merkleRoot, proof, txid }`.

1. Record missing or `merkleRoot` / `txid` / `proof` missing → `no-proof-found`
2. Proof (section 3) does not give `merkleRoot` → `merkle-proof-mismatch`
3. Read transaction `txid` from the chain. Not found → `transaction-not-found`
4. Root in its `OP_RETURN` (section 4) is missing or not `merkleRoot` → `on-chain-data-mismatch`
5. Else **valid**. Report:

```json
{ "valid": true, "confirmed": true, "txid": "...", "merkleRoot": "...",
  "blockHeight": 920123, "blockHash": "...", "blockTime": 1761404892, "date": "2026-10-25T15:08:12.000Z" }
```

`confirmed: false` = transaction is in the mempool, not in a block yet (`blockHeight`, `date` = null).
`date` = `blockTime` (Unix seconds) as ISO 8601 UTC with milliseconds.

The time of the proof is the **block time**: the document existed before that block.

## 6. Proof file

A JSON file the user keeps next to the document. Name: `<document>.btcnotar.json` or `<hash>.btcnotar.json`.

```json
{
  "format": "btcnotar-proof",
  "version": 1,
  "hash": "<64 hex>",
  "merkleRoot": "<64 hex>",
  "proof": [{ "position": "left", "hash": "<64 hex>" }],
  "txid": "<64 hex>",
  "network": "mainnet",
  "blockHeight": 920123,
  "blockHash": "<64 hex>",
  "blockTime": 1761404892,
  "date": "2026-10-25T15:08:12.000Z",
  "server": "https://...",
  "savedAt": "2026-10-25T16:00:00.000Z"
}
```

Required: `format`, `version`, `hash`, `merkleRoot`, `proof`, `txid`. `network` default = `mainnet`.
The block fields are for people to read — always take block data **from the chain**, not from the file.

Verify a file: if the user gives the document, `SHA-256(document)` must equal `hash`,
else `document-hash-mismatch`. Then run section 5. No BTCNotar server is used.

## 7. Server API

Base URL of the public server: `https://proofofexistance-production.up.railway.app`. JSON in and out.

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/api/notary/hash` | `{ "hashHex": "<64 hex>" }` | status (below) |
| POST | `/api/notary/hashes` | `{ "hashes": ["<64 hex>", …] }` (max 100) | `{ "results": [status or { hash, error }], "pendingCount" }` |
| GET | `/api/notary/proof/<hash>` | — | `200` anchored, `202` pending, `404` unknown |
| GET | `/api/notary/verify/<hash>` | — | the server's own verify result (clients should verify themselves) |
| POST | `/api/notary/settle` | — | admin only: anchor the queue now |

Status:

```json
{ "status": "pending", "hash": "...", "addedAt": "...", "nextSettleAt": "..." }
{ "status": "anchored", "hash": "...", "merkleRoot": "...", "proof": [...], "txid": "...",
  "batchId": "...", "batchStatus": "broadcast", "createdAt": "...", "blockHeight": null, "blockHash": null, "blockTime": null }
```

Errors: `400` bad input, `429` too many hashes per minute, `503` queue full, `500` server error.
Body: `{ "error": "text" }`.

A client must not trust the server: always verify `anchored` answers with section 5.

## 8. Chain API

The reference uses the [mempool.space REST API](https://mempool.space/docs/api/rest)
(`/api`, `/testnet/api`, `/testnet4/api`, `/signet/api`):

- `GET /tx/<txid>` → `status.confirmed`, `status.block_height`, `status.block_hash`, `status.block_time`, `vout[].scriptpubkey`
- `404` = transaction not known

Any other source (own Bitcoin node, Electrum) is fine if it gives the same data.

---

## Test vectors

[`test-vectors.json`](test-vectors.json) has:

- `sha256` — text → UTF-8 hex → SHA-256
- `trees` — hashes → root, proof for every leaf, OP_RETURN payload and script (1 to 13 leaves)
- `invalidProofs` — proofs that must be rejected

Generate again (only if the JS reference changes): `node spec/generate-vectors.mjs`.
