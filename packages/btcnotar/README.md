# btcnotar

Batch Bitcoin notarization for Node.js.

`btcnotar` collects document hashes, combines them into a **Merkle tree**,
and anchors only the tree's root on the Bitcoin blockchain via a single
`OP_RETURN` transaction — automatically, on a schedule (once a day by
default). Each individual hash gets back a small **inclusion proof** that
lets anyone later prove — unambiguously, against the live chain, down to
the transaction id, block and date — that their document was notarized,
without needing the rest of the batch.

## Why batching

Anchoring one hash per transaction is expensive and doesn't scale. Batching
thousands of hashes into one Merkle root per settlement means:

- **One on-chain transaction settles an unlimited number of documents.**
- **Cheap**: fees are paid once per batch, not per document.
- **Reversible / verifiable**: given only your original hash and its proof,
  you can recompute the Merkle root and confirm it matches what's actually
  on-chain — no trust in the notary's database required.

## Install

```bash
npm install btcnotar
```

## Quick start

```js
import { BTCNotar, FileStore } from "btcnotar";

const notary = new BTCNotar({
  wif: process.env.BTCNOTAR_WIF,       // Bitcoin private key (WIF) that funds/signs anchor txs
  network: "mainnet",                   // or "testnet"
  store: new FileStore({ filePath: "./.btcnotar/store.json" }),
  intervalMs: 24 * 60 * 60 * 1000,      // settle once a day (default)
});

// 1. Queue hashes as documents come in (e.g. sha256 of a file)
await notary.addHash("2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881");

// 2. Start automatic daily settlement (builds the Merkle tree + broadcasts
//    one OP_RETURN transaction anchoring the root)
notary.start();

// ... later, anywhere, even in a different process that only has the hash ...

const proof = await notary.getProof(hash);
// { hash, merkleRoot, proof, txid, batchId, blockHeight, blockHash, blockTime, ... }

const result = await notary.verify(hash);
// {
//   valid: true,
//   confirmed: true,
//   txid: "…",
//   blockHeight: 912345,
//   blockHash: "…",
//   date: "2026-09-10T00:00:00.000Z",
//   merkleRoot: "…",
// }
```

`verify()` does two independent checks before it reports `valid: true`:

1. **Cryptographic**: recomputes the Merkle root from the hash + its proof
   and checks it equals the stored root.
2. **On-chain**: fetches the anchoring transaction live from the blockchain
   and confirms its `OP_RETURN` output actually carries that same root.

Only when both agree is the hash reported as anchored — together with the
transaction id, block hash/height and date, so "is this document on the
blockchain, and when/where" has one unambiguous answer.

## Free public server (no key, no bitcoin)

Don't want to run your own notary? Send hashes to a public BTCNotar server.
The server batches them and pays the fee (one transaction per batch).
You verify the result yourself against the blockchain, so you don't have to trust the server.

```js
import { BTCNotarClient, sha256Hex } from "btcnotar";

const client = new BTCNotarClient({ serverUrl: "https://<notary-server>" });

const hash = sha256Hex(fs.readFileSync("contract.pdf"));
await client.submit(hash);        // { status: "pending", nextSettleAt: "..." }

// after the next settlement (see nextSettleAt):
await client.verify(hash);        // { valid: true, confirmed: true, txid, blockHeight, date }
```

- `submit(hash)` — add the hash to the server queue.
- `getProof(hash)` — proof record, `{ status: "pending" }` while waiting, or `null`.
- `verify(hash)` — gets the proof from the server and checks it on-chain (mempool.space by default, or pass your own `provider`).

From the command line:

```
npx btcnotar submit "any text or a sha256 hash" --server https://<notary-server>
npx btcnotar check  "any text or a sha256 hash" --server https://<notary-server>
```

## API

### `new BTCNotar(options)`

| option        | required | default             | description |
|---------------|----------|---------------------|-------------|
| `wif`         | yes      | —                   | Bitcoin private key (WIF) used to fund and sign anchor transactions |
| `network`     | no       | `"mainnet"`         | `"mainnet"` or `"testnet"` |
| `store`       | no       | `new MemoryStore()` | pending hashes + settled batches storage (see below) |
| `provider`    | no       | `new MempoolProvider()` | chain data source (UTXOs, fees, broadcast, tx lookup) |
| `feeRateSatVb`| no       | fetched live        | fixed fee rate override (sat/vB) |
| `intervalMs`  | no       | `86400000` (24h)    | used by `start()`: a batch is anchored once the oldest pending hash has waited this long (no tx while the queue is empty) |

### Instance methods

- `addHash(hashHex)` — queue a hex-encoded hash for the next settlement.
- `pendingCount()` — number of hashes waiting to be settled.
- `settle()` — build a Merkle tree over everything pending and anchor its
  root in one `OP_RETURN` transaction right now. Returns the batch record
  (`{ batchId, merkleRoot, txid, hashes, proofs, ... }`), or `null` if
  nothing was pending.
- `start({ intervalMs })` / `stop()` — automatic settlement: checks every minute and anchors when the oldest pending hash is `intervalMs` old. Survives restarts (uses the stored `addedAt`).
- `settleIfDue()` — the check `start()` runs; anchors only if something has waited `intervalMs`.
- `getStatus(hash)` — `{ status: "anchored", ...proof }`, `{ status: "pending", addedAt, nextSettleAt }` or `null`.
- `anchorNow(hash)` — anchor one hash immediately (together with anything already queued) and return its proof. If the hash is already anchored, returns the existing proof without a new transaction.
- `getProof(hashHex)` — look up the stored proof + anchor info for a hash.
- `verify(hashHex)` — cryptographically and on-chain verification (see above).
- `refreshStatus(batchId)` — re-fetch a batch's transaction and update its
  confirmation / block info.

### `MerkleTree`

The underlying Merkle tree, usable standalone:

```js
import { MerkleTree } from "btcnotar";

const tree = new MerkleTree([hashA, hashB, hashC]);
tree.root;                       // hex string
const proof = tree.getProof(0);  // inclusion proof for hashA
MerkleTree.verifyProof(hashA, proof, tree.root); // true
```

Leaves are domain-separated from internal nodes (distinct hash prefixes),
and an unpaired node at the end of a level is carried up unchanged rather
than duplicated — this avoids both the classic leaf/node confusion forgery
and the Bitcoin-style duplicate-leaf ambiguity (CVE-2012-2459).

### Storage

`MemoryStore` (default, non-persistent) and `FileStore` (JSON file on disk)
are included and share the same interface: `addPending`, `listPending`,
`clearPending`, `saveBatch`, `getBatch`, `findBatchByHash`, `listBatches`.
Implement the same interface against a real database for multi-process or
production use.

### Chain provider

`MempoolProvider` talks to the public [mempool.space](https://mempool.space)
REST API for UTXOs, fee estimation, broadcasting and transaction lookup.
Supply your own object implementing `fetchUtxos`, `fetchFeeRateSatVb`,
`broadcastTx`, `fetchTransaction` to use a different backend (e.g. a local
`bitcoind` or Electrum server).

## CLI

The package also installs a `btcnotar` command:

```bash
export BTCNOTAR_WIF=...        # required
export BTCNOTAR_NETWORK=mainnet
export BTCNOTAR_STORE=./.btcnotar/store.json

npx btcnotar add <hash>
npx btcnotar settle
npx btcnotar proof <hash>
npx btcnotar verify <hash>
npx btcnotar address
```

`btcnotar settle` is handy if you'd rather trigger settlement from an
external scheduler (system cron, a serverless cron trigger) instead of the
built-in `start()` interval.

## How anchoring works on-chain

Each settlement broadcasts one transaction with a zero-value `OP_RETURN`
output carrying:

```
"BTN1" (4 bytes, protocol magic)  ||  Merkle root (32 bytes)
```

36 bytes total, well within Bitcoin's 80-byte `OP_RETURN` limit. The magic
prefix lets `verify()` recognize a BTCNotar anchor (and reject unrelated
`OP_RETURN` data) before trusting its contents as a Merkle root.

## License

MIT
