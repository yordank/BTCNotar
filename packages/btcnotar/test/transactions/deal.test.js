import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalize, finalizeDeal, signDeal, verifyApprovals, createReceipt, verifyReceipt } from '../../src/transactions/index.js';
const alice = generateKeyPairSync('ed25519');
const bob = generateKeyPairSync('ed25519');
const trustedKeys = { alice: alice.publicKey, bob: bob.publicKey };
const input = { id: 'property-001', type: 'real-estate', terms: { currency: 'EUR', priceMinor: '200000000' }, participants: [{ id: 'alice', role: 'investor', ownershipBps: 6000 }, { id: 'bob', role: 'investor', ownershipBps: 4000 }], policies: [{ id: 'purchase', role: 'investor', threshold: 2 }] };
test('canonicalization sorts object keys and rejects floats', () => {
  assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
  assert.throws(() => canonicalize({ amount: 1.25 }), /Unsupported/);
});
test('ownership and policy validation', () => {
  assert.throws(() => finalizeDeal({ ...input, participants: [{ id: 'alice', role: 'investor', ownershipBps: 9999 }] }), /10000/);
  assert.throws(() => finalizeDeal({ ...input, policies: [{ id: 'purchase', role: 'investor', threshold: 3 }] }), /threshold/);
});
test('two independently signed approvals and tamper detection', () => {
  const deal = finalizeDeal(input);
  const signatures = [signDeal(deal.hash, { participantId: 'alice', privateKey: alice.privateKey }), signDeal(deal.hash, { participantId: 'bob', privateKey: bob.privateKey })];
  assert.equal(verifyApprovals({ record: deal.record, hash: deal.hash, signatures: signatures.slice(0, 1), trustedKeys, policyId: 'purchase' }).valid, false);
  const receipt = createReceipt({ deal, signatures });
  assert.equal(verifyReceipt(receipt, { trustedKeys, policyId: 'purchase' }).valid, true);
  assert.equal(verifyReceipt({ ...receipt, deal: { ...receipt.deal, terms: { priceMinor: '1' } } }, { trustedKeys, policyId: 'purchase' }).valid, false);
  assert.equal(verifyReceipt({ ...receipt, commitmentHash: '0'.repeat(64) }, { trustedKeys, policyId: 'purchase' }).valid, false);
});
