# BTCNotar multi-party transactions — experimental v1

This optional Node.js module produces deterministic deal hashes, verifies Ed25519 signatures against **externally trusted** participant keys, and creates a hash-only commitment suitable for submission to the existing BTCNotar client.

**Security boundaries:** BTCNotar anchoring proves inclusion/existence of a digest, not property ownership, legal validity, actual payment, correct financial analysis, or signing time. `verifyReceipt` checks deal/signature integrity and a local threshold policy; it does **not** verify the Bitcoin anchor (`anchorVerified: false`). Verify any returned Bitcoin proof separately using the existing BTCNotar proof verifier. An application must enforce authorization *before* executing transfers or property actions.

## Data model

- `ownershipBps` is an integer in [0,10000], totaling 10000 across participants; this models a single fully allocated equity class only.
- Financial amounts should be integer minor units serialized as strings, never floating-point currency values.
- `terms` is a caller-defined JSON value. It must be validated by the application; this module does not offer jurisdiction-specific legal schemas.
- `documents` carry SHA-256 digests of bytes; document contents stay off-chain.
- `previousDigest` links amendments to a prior finalized deal; external workflow must verify continuity and authorization.
- Canonicalization is a restricted JSON encoding: object keys sorted, only safe integer numbers, no undefined or non-plain objects. This is not RFC 8785/JCS; changing encoding requires a version bump.
- `deal.hash = SHA256(canonicalize({domain:'btcnotar/deal/v1',record}))`.
- Each Ed25519 signature signs the raw 32-byte deal hash; keys must be provisioned and authenticated out-of-band.
- `commitmentHash = SHA256(canonicalize({domain:'btcnotar/transaction/v1',signed:{dealHash,signatures}}))`.

## API

```js
import { finalizeDeal, signDeal, createReceipt, verifyReceipt } from 'btcnotar/transactions';
import { BTCNotarClient } from 'btcnotar/client';

// finalizeDeal(...) -> { record, hash }
// signDeal(deal.hash, { participantId, privateKey })
// createReceipt({ deal, signatures }) -> { commitmentHash, ... }
// const client = new BTCNotarClient();
// await client.submit(receipt.commitmentHash); // optional network operation
// verifyReceipt(receipt, { trustedKeys, policyId })
```

This initial commit exposes a **JavaScript/TypeScript SDK subpath only**. CLI `deal` subcommands, browser crypto, real estate jurisdiction adapters, AI analysis, and end-to-end Bitcoin receipt verification are future reviewable increments.
