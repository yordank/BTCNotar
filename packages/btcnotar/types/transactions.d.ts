export interface Participant { id: string; role: string; ownershipBps: number }
export interface DocumentDigest { id: string; sha256: string }
export interface ApprovalPolicy { id: string; role: string; threshold: number }
export interface DealRecord { format: 'btcnotar-deal'; version: 1; id: string; type: string; terms: unknown; participants: Participant[]; documents: DocumentDigest[]; policies: ApprovalPolicy[]; previousDigest: string | null }
export interface FinalizedDeal { record: DealRecord; hash: string }
export interface DealSignature { participantId: string; algorithm: 'Ed25519'; signature: string }
export interface TransactionReceipt { format: 'btcnotar-transaction-receipt'; version: 1; deal: DealRecord; dealHash: string; signatures: DealSignature[]; commitmentHash: string; anchorProof: unknown | null }
export function canonicalize(value: unknown): string;
export function digest(value: unknown): string;
export function finalizeDeal(input: { id: string; type: string; terms: unknown; participants: Participant[]; documents?: DocumentDigest[]; policies?: ApprovalPolicy[]; previousDigest?: string | null }): FinalizedDeal;
export function signDeal(hash: string, input: { participantId: string; privateKey: import('node:crypto').KeyLike }): DealSignature;
export function verifyApprovals(input: { record: DealRecord; hash: string; signatures: DealSignature[]; trustedKeys: Record<string, import('node:crypto').KeyLike>; policyId: string }): { valid: boolean; reason?: string; approvals?: number; required?: number };
export function createReceipt(input: { deal: FinalizedDeal; signatures: DealSignature[]; anchorProof?: unknown }): TransactionReceipt;
export function verifyReceipt(receipt: TransactionReceipt, input: { trustedKeys: Record<string, import('node:crypto').KeyLike>; policyId: string }): { valid: boolean; reason?: string; approvals?: number; required?: number; commitmentMatches?: boolean; anchorVerified?: boolean };
