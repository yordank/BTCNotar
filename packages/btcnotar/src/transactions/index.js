import { createHash, createPublicKey, KeyObject, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

export const DEAL_FORMAT = 'btcnotar-deal';
export const DEAL_VERSION = 1;
const HEX = /^[a-f0-9]{64}$/i;
const BPS = 10000;

export function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value) && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new TypeError('Unsupported canonical value: use plain JSON, safe integers, and no undefined');
}
export function digest(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function uniqueIds(items, label) {
  const ids = items.map(x => x.id);
  assert(ids.every(x => typeof x === 'string' && x.length > 0), `${label} IDs must be nonempty`);
  assert(new Set(ids).size === ids.length, `Duplicate ${label} ID`);
}
export function finalizeDeal({ id, type, terms, participants, documents = [], policies = [], previousDigest = null }) {
  assert(typeof id === 'string' && id.length > 0, 'Deal ID required');
  assert(typeof type === 'string' && type.length > 0, 'Deal type required');
  assert(Array.isArray(participants) && participants.length > 0, 'Participants required');
  uniqueIds(participants, 'participant');
  assert(participants.every(p => typeof p.role === 'string' && p.role), 'Participant role required');
  assert(participants.every(p => Number.isSafeInteger(p.ownershipBps) && p.ownershipBps >= 0 && p.ownershipBps <= BPS), 'Invalid ownership basis points');
  assert(participants.reduce((n, p) => n + p.ownershipBps, 0) === BPS, 'Ownership must total 10000 bps');
  uniqueIds(documents, 'document');
  assert(documents.every(d => HEX.test(d.sha256)), 'Document SHA-256 required');
  uniqueIds(policies, 'policy');
  for (const p of policies) {
    assert(typeof p.role === 'string' && p.role, 'Policy role required');
    const eligible = participants.filter(x => x.role === p.role).length;
    assert(Number.isSafeInteger(p.threshold) && p.threshold > 0 && p.threshold <= eligible, 'Invalid approval threshold');
  }
  assert(previousDigest === null || HEX.test(previousDigest), 'Invalid previous digest');
  const record = { format: DEAL_FORMAT, version: DEAL_VERSION, id, type, terms, participants, documents, policies, previousDigest };
  const hash = digest({ domain: 'btcnotar/deal/v1', record });
  return { record, hash };
}
export function signDeal(hash, { participantId, privateKey }) {
  assert(HEX.test(hash), 'Invalid deal digest');
  assert(typeof participantId === 'string' && participantId, 'Participant ID required');
  const signature = cryptoSign(null, Buffer.from(hash, 'hex'), privateKey).toString('base64');
  return { participantId, algorithm: 'Ed25519', signature };
}
export function verifyApprovals({ record, hash, signatures, trustedKeys, policyId }) {
  if (!record || digest({ domain: 'btcnotar/deal/v1', record }) !== hash) return { valid: false, reason: 'Deal digest mismatch' };
  if (record.format !== DEAL_FORMAT || record.version !== DEAL_VERSION) return { valid: false, reason: 'Unsupported deal version' };
  const policy = record.policies.find(p => p.id === policyId);
  if (!policy) return { valid: false, reason: 'Unknown policy' };
  const approved = new Set();
  for (const entry of signatures) {
    const participant = record.participants.find(p => p.id === entry.participantId);
    if (!participant || participant.role !== policy.role || entry.algorithm !== 'Ed25519') continue;
    const key = trustedKeys[entry.participantId];
    if (!key) continue;
    try {
      if (cryptoVerify(null, Buffer.from(hash, 'hex'), (key instanceof KeyObject ? key : createPublicKey(key)), Buffer.from(entry.signature, 'base64'))) approved.add(entry.participantId);
    } catch { /* invalid key or signature */ }
  }
  return { valid: approved.size >= policy.threshold, approvals: approved.size, required: policy.threshold };
}
export function createReceipt({ deal, signatures, anchorProof = null }) {
  assert(deal?.record && HEX.test(deal.hash), 'Finalized deal required');
  assert(digest({ domain: 'btcnotar/deal/v1', record: deal.record }) === deal.hash, 'Deal digest mismatch');
  const signed = { dealHash: deal.hash, signatures };
  return { format: 'btcnotar-transaction-receipt', version: 1, deal: deal.record, dealHash: deal.hash, signatures, commitmentHash: digest({ domain: 'btcnotar/transaction/v1', signed }), anchorProof };
}
export function verifyReceipt(receipt, { trustedKeys, policyId }) {
  if (receipt?.format !== 'btcnotar-transaction-receipt' || receipt.version !== 1) return { valid: false, reason: 'Unsupported receipt' };
  const approvals = verifyApprovals({ record: receipt.deal, hash: receipt.dealHash, signatures: receipt.signatures, trustedKeys, policyId });
  const commitmentHash = digest({ domain: 'btcnotar/transaction/v1', signed: { dealHash: receipt.dealHash, signatures: receipt.signatures } });
  return { ...approvals, valid: approvals.valid && commitmentHash === receipt.commitmentHash, commitmentMatches: commitmentHash === receipt.commitmentHash, anchorVerified: false };
}
