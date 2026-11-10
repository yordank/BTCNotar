import { generateKeyPairSync } from 'node:crypto';
import { finalizeDeal, signDeal, createReceipt, verifyReceipt } from '../../packages/btcnotar/src/transactions/index.js';
const alice = generateKeyPairSync('ed25519');
const bob = generateKeyPairSync('ed25519');
const deal = finalizeDeal({ id: 'example-property', type: 'real-estate', terms: { currency: 'EUR', purchasePriceMinor: '200000000' }, participants: [{ id: 'alice', role: 'investor', ownershipBps: 6000 }, { id: 'bob', role: 'investor', ownershipBps: 4000 }], policies: [{ id: 'purchase', role: 'investor', threshold: 2 }] });
const signatures = [signDeal(deal.hash, { participantId: 'alice', privateKey: alice.privateKey }), signDeal(deal.hash, { participantId: 'bob', privateKey: bob.privateKey })];
const receipt = createReceipt({ deal, signatures });
console.log(JSON.stringify({ dealHash: deal.hash, commitmentHash: receipt.commitmentHash, verification: verifyReceipt(receipt, { trustedKeys: { alice: alice.publicKey, bob: bob.publicKey }, policyId: 'purchase' }) }, null, 2));
