# btcnotar

**Prove that a text or a file existed at a certain time — using the Bitcoin blockchain.**

- **Free.** No Bitcoin, no wallet, no key. The public server pays the fee.
- **Private.** Only the SHA-256 hash is sent. Your file never leaves your computer.
- **Trustless.** `verify()` checks the proof directly on the blockchain, not on our server.
- **TypeScript types** included. Python version: `pip install btcnotar`.
- **For AI agents:** MCP server [`btcnotar-mcp`](https://www.npmjs.com/package/btcnotar-mcp) (Claude, Cursor, VS Code).

⚡ Like it? Support with sats: `trappedknight861@walletofsatoshi.com`

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
import { BTCNotarClient, sha256File } from "btcnotar";

const client = new BTCNotarClient();
const hash = await sha256File("contract.pdf"); // reads the file as a stream, works for big files

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

const sent = await client.submitMany(texts.map((t) => sha256Hex(t))); // one request per 100 hashes
const results = texts.map((text, i) => ({ text, hash: sent[i].hash, status: sent[i].status ?? sent[i].error }));

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

### 6. Save the proof — verify even if the server is gone

The server keeps your proof. But you should keep a copy too.
With the proof file you can verify **without any BTCNotar server** — only the Bitcoin blockchain is needed.

```js
// save-proof.mjs
import fs from "node:fs";
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient();
const hash = sha256Hex(fs.readFileSync("contract.pdf"));

await client.submit(hash);
await client.waitForProof(hash);                          // waits until it is in a transaction (~1 hour)
await client.saveProof(hash, "contract.pdf.btcnotar.json");
```

```js
// verify-proof.mjs  — works years later, no server needed
import { verifyProofFile } from "btcnotar";

const r = await verifyProofFile("contract.pdf.btcnotar.json", { file: "contract.pdf" });
console.log(r.valid ? `YES, block ${r.blockHeight}, ${r.date}` : `NO: ${r.reason}`);
```

Command line:

```bash
npx btcnotar submit --file contract.pdf
npx btcnotar wait   --file contract.pdf
npx btcnotar save   --file contract.pdf            # -> contract.pdf.btcnotar.json
npx btcnotar verify-file contract.pdf.btcnotar.json --doc contract.pdf
```

Keep the proof file next to the document. If one of them is lost or changed, the proof is gone.

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
{ valid: false, reason: "document-hash-mismatch" }          // verifyProofFile: the document was changed
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

Other settings: `BTCNOTAR_NETWORK` (`mainnet`/`testnet`), `BTCNOTAR_STORE` (store file),
`BTCNOTAR_MEMPOOL_API` (your own mempool.space API). They can also be in a `.env` file (Node 20.12+).

---

## API

### Light import: `btcnotar/client`

Only need the free server and verification? Import from `btcnotar/client`.
It does not load `bitcoinjs-lib` (no key, no signing code):

```js
import { BTCNotarClient, sha256File, verifyProofFile } from "btcnotar/client";
```

### `new BTCNotarClient(options?)` — free public server

| option | default | description |
|---|---|---|
| `serverUrl` | public server | your own server URL |
| `network` | `"mainnet"` | `"mainnet"` or `"testnet"` |
| `provider` | `MempoolProvider` | where `verify()` reads the blockchain |
| `timeoutMs` | `20000` | HTTP timeout |

- `submit(hash)` — add a hash to the queue → `{ status, hash, addedAt, nextSettleAt }`
- `verify(hash)` — check on the blockchain → see [What verify() returns](#what-verify-returns)
- `submitMany(hashes)` — many hashes, one request per 100. One result per hash, same order: `{ status, ... }` or `{ hash, error }`
- `getProof(hash)` — raw proof, `{ status: "pending" }`, or `null`
- `waitForProof(hash, { intervalMs, timeoutMs, confirmed, onUpdate })` — wait until the hash is in a transaction (with `confirmed: true` — in a block). Default: check every minute, give up after 3 hours
- `downloadProof(hash)` — proof file object (see below)
- `saveProof(hash, filePath)` — download the proof and save it as JSON

### `verifyProofFile(fileOrObject, { file, hash, provider }?)`

Verify a saved proof file against the blockchain. No server is used.
`file` (path or Buffer) or `hash` — check that the proof is for this document.

### Proof file format

```json
{
  "format": "btcnotar-proof",
  "version": 1,
  "hash": "<sha256 of the document>",
  "merkleRoot": "<root in the OP_RETURN>",
  "proof": [{ "position": "left", "hash": "..." }],
  "txid": "...",
  "network": "mainnet",
  "blockHeight": 920123,
  "blockHash": "...",
  "blockTime": 1761404892,
  "date": "2026-10-25T15:08:12.000Z",
  "server": "https://...",
  "savedAt": "..."
}
```

Only `hash`, `merkleRoot`, `proof`, `txid` and `network` are needed to verify. The rest is for people to read.

### `sha256Hex(textOrBuffer)` / `sha256File(path)`

SHA-256 of a string (UTF-8) or a Buffer, as a hex string.
`sha256File` reads a file as a stream (any size) and returns a Promise.

### `new BTCNotar(options)` — your own notary

| option | default | description |
|---|---|---|
| `wif` | — (required) | private key that pays and signs |
| `network` | `"mainnet"` | `"mainnet"` or `"testnet"` |
| `store` | `MemoryStore` (lost on exit) | use `FileStore({ filePath })` to keep data |
| `intervalMs` | 24 hours | `start()` anchors when the oldest queued hash is this old |
| `feeRateSatVb` | live from mempool.space | fixed fee (sat/vB) |
| `provider` | `MempoolProvider` | blockchain backend |

How `settle()` keeps you safe:

- The signed transaction and all proofs are **saved before** it is sent. If the process stops, the next `settle()` / `start()` sends it again.
- If the network rejects it, the hashes go back to the queue.
- It picks a UTXO that is big enough for the fee.
- The transaction uses Replace-By-Fee, so you can raise the fee if it is stuck.

Methods: `address`, `addHash(hash)`, `exportProof(hash)`, `saveProof(hash, filePath)`, `pendingCount()`, `settle()`, `anchorNow(hash)`, `start()`, `stop()`, `settleIfDue()`, `getStatus(hash)`, `getProof(hash)`, `verify(hash)`, `refreshStatus(batchId)`.

### Other exports

`MerkleTree`, `verifyProof(hash, proof, provider)`, `readProofFile`, `writeProofFile`, `toProofFile`, `MemoryStore`, `FileStore`, `MempoolProvider`, `selectUtxo`, `DEFAULT_SERVER_URL`.

Your own store (e.g. a database): implement `addPending`, `listPending`, `clearPending`, `saveBatch`, `getBatch`, `findBatchByHash`, `listBatches`, `deleteBatch` (see `types/index.d.ts`).

The full format is in [spec/SPEC.md](https://github.com/yordank/BTCNotar/blob/main/spec/SPEC.md).

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

## Support the project ⚡

`btcnotar` and the public server are free — the server pays the Bitcoin fees.
If you like it, you can send any amount of sats to this Lightning address:

**`trappedknight861@walletofsatoshi.com`**

## License

MIT
