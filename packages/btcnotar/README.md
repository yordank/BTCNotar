# btcnotar

**Prove that a text or a file existed at a certain time — using the Bitcoin blockchain.**

- **Free.** No Bitcoin, no wallet, no key. The public server pays the fee.
- **Private.** Only the SHA-256 hash is sent. Your file never leaves your computer.
- **Trustless.** `verify()` checks the proof directly on the blockchain, not on our server.

```bash
npm install btcnotar
```

---

## Easy examples

All examples use the free public server. Save them as `.mjs` files and run with `node`.

### 1. Notarize a text

```js
// notarize-text.mjs
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient();
const hash = sha256Hex("Hello, Bitcoin!");

const result = await client.submit(hash);
console.log(result);
// { status: "pending", hash: "...", nextSettleAt: "2026-10-25T15:00:00.000Z" }
```

`pending` means: your hash is in the queue. It goes on the blockchain at `nextSettleAt` (about 1 hour).

### 2. Check it later

```js
// check-text.mjs
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient();
const result = await client.verify(sha256Hex("Hello, Bitcoin!"));

if (result.valid) {
  console.log("On the blockchain!");
  console.log("Date: ", result.date);
  console.log("Block:", result.blockHeight);
  console.log("Tx:   ", `https://mempool.space/tx/${result.txid}`);
} else {
  console.log("Not yet:", result.reason); // "pending" = still waiting
}
```

### 3. Notarize a file

```js
// notarize-file.mjs
import fs from "node:fs";
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient();
const hash = sha256Hex(fs.readFileSync("contract.pdf"));

console.log("SHA-256:", hash);
console.log(await client.submit(hash));
```

Keep the file **exactly as it is**. If one byte changes, the hash changes and the proof will not match.

### 4. Many texts, save results, check later

```js
// many.mjs
import fs from "node:fs";
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient();
const texts = ["first text", "second text", "third text"];

const results = [];
for (const text of texts) {
  const hash = sha256Hex(text);
  const r = await client.submit(hash);
  results.push({ text, hash, status: r.status, nextSettleAt: r.nextSettleAt });
}

fs.writeFileSync("results.json", JSON.stringify(results, null, 2));
console.log("Saved to results.json");
```

```js
// check-many.mjs
import fs from "node:fs";
import { BTCNotarClient } from "btcnotar";

const client = new BTCNotarClient();
const results = JSON.parse(fs.readFileSync("results.json", "utf8"));

for (const item of results) {
  const r = await client.verify(item.hash);
  console.log(item.text, "->", r.valid ? `YES, block ${r.blockHeight}, ${r.date}` : `not yet (${r.reason})`);
}
```

All texts sent in the same hour go into **one** Bitcoin transaction.

### 5. Command line (no code)

```bash
npx btcnotar submit "Hello, Bitcoin!"
npx btcnotar check  "Hello, Bitcoin!"
```

You can give a text or a SHA-256 hash (64 hex characters).

---

## How long does it take?

| Step | Time |
|---|---|
| `submit()` | instant — status `pending` |
| Hash goes into a Bitcoin transaction | at `nextSettleAt` (about every hour) |
| Transaction is in a block | about 10 minutes later |

After the transaction is sent, `verify()` returns `valid: true`.
`confirmed: false` means it is still waiting for a block. `confirmed: true` means it is in a block.

## What `verify()` returns

```js
{ valid: true, confirmed: true, txid: "...", blockHeight: 920123, date: "2026-10-25T15:08:12.000Z", merkleRoot: "..." }
{ valid: false, reason: "pending", nextSettleAt: "..." }   // waiting in the queue
{ valid: false, reason: "unknown-hash" }                    // never sent
{ valid: false, reason: "merkle-proof-mismatch" }           // proof is wrong
{ valid: false, reason: "on-chain-data-mismatch" }          // blockchain has different data
```

## Why you don't need to trust the server

`verify()` downloads the proof from the server, then:

1. rebuilds the Merkle root from your hash and the proof, and
2. reads the real Bitcoin transaction from [mempool.space](https://mempool.space) and checks that its `OP_RETURN` contains that root.

If the server lies, the check fails.

---

## Run your own notary (with your own Bitcoin)

If you want your own server, use `BTCNotar` with your own key (WIF) and a funded address.

```js
import { BTCNotar, FileStore, sha256Hex } from "btcnotar";

const notary = new BTCNotar({
  wif: process.env.BTCNOTAR_WIF,                       // your private key (WIF)
  store: new FileStore({ filePath: "./store.json" }),  // keeps queue and proofs
  intervalMs: 60 * 60 * 1000,                          // anchor every hour (if queue is not empty)
});

console.log("Fund this address:", notary.address);

await notary.addHash(sha256Hex("my document"));  // add to queue
notary.start();                                  // anchors automatically

// or right now:
const proof = await notary.anchorNow(sha256Hex("urgent document"));
console.log(proof.txid);

// check:
console.log(await notary.verify(sha256Hex("my document")));
```

Command line for your own notary:

```bash
export BTCNOTAR_WIF=...                  # required
npx btcnotar address                     # address to fund
npx btcnotar add <hash>                  # add to queue
npx btcnotar settle                      # send the transaction now
npx btcnotar verify <hash>               # check on the blockchain
```

---

## API

### `new BTCNotarClient(options?)` — free public server

| option | default | description |
|---|---|---|
| `serverUrl` | public server | your own server URL |
| `network` | `"mainnet"` | `"mainnet"` or `"testnet"` |
| `provider` | `MempoolProvider` | where `verify()` reads the blockchain |

- `submit(hash)` — add a hash to the queue → `{ status, hash, addedAt, nextSettleAt }`
- `verify(hash)` — check on the blockchain → see [What verify() returns](#what-verify-returns)
- `getProof(hash)` — raw proof, `{ status: "pending" }`, or `null`

### `sha256Hex(textOrBuffer)`

SHA-256 of a string (UTF-8) or a Buffer, as a hex string.

### `new BTCNotar(options)` — your own notary

| option | default | description |
|---|---|---|
| `wif` | — (required) | private key that pays and signs |
| `network` | `"mainnet"` | `"mainnet"` or `"testnet"` |
| `store` | `MemoryStore` (lost on exit) | use `FileStore({ filePath })` to keep data |
| `intervalMs` | 24 hours | `start()` anchors when the oldest queued hash is this old |
| `feeRateSatVb` | live from mempool.space | fixed fee (sat/vB) |
| `provider` | `MempoolProvider` | blockchain backend |

Methods: `address`, `addHash(hash)`, `pendingCount()`, `settle()`, `anchorNow(hash)`, `start()`, `stop()`, `settleIfDue()`, `getStatus(hash)`, `getProof(hash)`, `verify(hash)`, `refreshStatus(batchId)`.

### Other exports

`MerkleTree`, `verifyProof(hash, proof, provider)`, `MemoryStore`, `FileStore`, `MempoolProvider`, `DEFAULT_SERVER_URL`.

---

## How it looks on the blockchain

Every batch is one transaction with an `OP_RETURN` output:

```
42544e31 + <Merkle root, 32 bytes>
 "BTN1"
```

Your hash is not visible on the blockchain — only the Merkle root of all hashes in the batch.
The proof connects your hash to that root.

Merkle tree: leaf = `sha256(0x00 || hash)`, node = `sha256(0x01 || left || right)`, an odd node is moved up unchanged.

## License

MIT
