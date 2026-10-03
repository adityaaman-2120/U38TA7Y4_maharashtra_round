export type VaultState = 'ACTIVE' | 'RECOVERY_PENDING' | 'RELEASED' | 'CLAIMED';

export type AssetCategory = 'document' | 'credential' | 'wallet-seed' | 'personal-record' | 'other';

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  document: 'Document',
  credential: 'Credential',
  'wallet-seed': 'Wallet seed phrase',
  'personal-record': 'Personal record',
  other: 'Other',
};

export type Role = 'owner' | 'guardian' | 'heir';

export interface Guardian {
  id: number;
  name: string;
  /** Guardian unreachable — cannot attest or release. Demo toggle. */
  online: boolean;
  /** Has signed "owner is unavailable". */
  attested: boolean;
  attestedAt?: number;
  /** Has published its sealed share. Only legal in RELEASED. */
  shareReleased: boolean;
}

export type AuditKind =
  | 'vault-created'
  | 'heartbeat'
  | 'attestation'
  | 'attestation-withdrawn'
  | 'recovery-started'
  | 'recovery-cancelled'
  | 'released'
  | 'share-released'
  | 'claimed'
  | 'claim-rejected'
  | 'guardian-toggled'
  | 'demo';

export interface AuditEntry {
  id: string;
  at: number;
  kind: AuditKind;
  actor: string;
  message: string;
}

/** A Shamir share sealed to the heir's public key, held by one guardian. */
export interface SealedShare {
  guardianId: number;
  /** ECIES ciphertext, hex. Public once released — useless without 2 more. */
  sealedHex: string;
}

export interface Vault {
  id: string;
  name: string;
  category: AssetCategory;
  state: VaultState;

  /** Encrypted asset. Stands in for an IPFS CID's contents. */
  ciphertextHex: string;
  ivHex: string;
  assetFilename: string;
  assetIsText: boolean;

  /** All five sealed shares, one per guardian slot. */
  shares: SealedShare[];
  guardians: Guardian[];

  /** sha256(heirID + salt), published at creation. */
  heirCommitment: string;
  heirPubHex: string;
  /** Heir's private key. In reality lives only on the heir's device. */
  heirPrivHex: string;
  /** The wallet address registered as the heir's. */
  heirWallet: string;

  heartbeatIntervalMs: number;
  lastHeartbeatAt: number;
  /** Set when the vault enters RECOVERY_PENDING. */
  recoveryStartedAt?: number;
  challengeWindowMs: number;

  createdAt: number;
  audit: AuditEntry[];
}
