# Changelog

## 0.4.0

- Safer `settle()`: the signed transaction and proofs are saved before sending; resent after a crash; hashes go back to the queue if the network rejects the tx
- Picks a UTXO that is big enough for the fee (not just the first one)
- Transactions signal Replace-By-Fee
- `FileStore` writes atomically (no broken JSON after a crash)
- `addHash` accepts only 64 hex chars, and does not queue a hash that is already anchored
- Fix: hashes with upper case letters were not found in the store
- New: `client.submitMany(hashes)`, `sha256File(path)`
- New light entry `btcnotar/client` (no bitcoinjs-lib)
- TypeScript types
- No more `axios` and `dotenv` dependencies (uses built-in `fetch`)
- CLI: `BTCNOTAR_MEMPOOL_API`

## 0.3.0

- Proof files: `waitForProof`, `saveProof`, `downloadProof`, `verifyProofFile`
- CLI: `wait`, `save`, `verify-file`, `--file`
