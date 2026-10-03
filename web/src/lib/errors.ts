import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const MESSAGES: Record<string, string> = {
  InvalidEncryptionKey: "Invalid encryption key.",
  NoEncryptionKey: "An address involved has not registered an encryption key yet.",
  VaultExists: "You already have a vault.",
  NoVault: "You do not have a vault.",
  InvalidGuardians: "Guardians must be 3–7 unique addresses, not including yourself.",
  InvalidThreshold: "Threshold must be at least 2 and at most the number of guardians.",
  PeriodTooShort: "Periods must be at least 5 minutes.",
  InvalidPolicy: "Invalid policy: approvals must be between the threshold and guardian count, and the unlock time must be in the future.",
  InvalidShares: "Share count does not match the guardian set.",
  InvalidBeneficiary: "Invalid beneficiary.",
  EmptyField: "A required field is empty.",
  NotOwner: "Only the owner can do this.",
  NotBeneficiary: "Only the beneficiary can do this.",
  NotGuardian: "Only a guardian of this claim can do this.",
  NoSuchAsset: "Asset not found.",
  NoSuchClaim: "Claim not found.",
  AssetAlreadyReleased: "This asset has already been released.",
  AssetSharesStale: "Guardians changed; the owner must re-share this asset first.",
  EvidenceTypeMismatch: "Evidence type not accepted by this asset's policy.",
  NotInactiveLongEnough: "The owner has checked in too recently to raise a claim.",
  ClaimAlreadyActive: "There is already an active claim on this asset.",
  ClaimNotRaised: "This claim is no longer open.",
  ClaimNotFinalized: "This claim has not been finalized.",
  ClaimInvalidatedByHeartbeat: "The owner checked in after this claim was raised, so it is invalid.",
  ClaimFlaggedFraud: "A guardian flagged this claim as fraud.",
  AlreadyResponded: "You already responded to this claim.",
  AlreadyFlagged: "You already flagged this claim.",
  VaultFrozen: "The vault is frozen by its owner.",
  VaultNotFrozen: "The vault is not frozen.",
  ChallengePeriodNotOver: "The challenge period has not ended yet.",
  NotYetUnlocked: "The asset's unlock time has not been reached.",
  NotEnoughApprovals: "Not enough guardian approvals yet.",
  ShareAlreadyReleased: "You already released your share.",
  IdentityDisabled: "This deployment has no identity verifier.",
  InvalidSeed: "Invalid identity configuration.",
  InvalidProof: "The identity proof was not accepted. It may be for a different wallet, claim or purpose, or not valid.",
  StaleProof: "The identity proof is too old. Proofs must be made within the last 3 hours; generate a new one.",
  AlreadyVerified: "This wallet has already verified an identity.",
  NullifierAlreadyUsed: "This identity is already linked to another wallet. One person can verify only one wallet.",
  GuardianNotVerified: "Every guardian must verify an identity first, because this vault requires verified guardians.",
  BeneficiaryNotVerified: "The beneficiary must verify an identity before a file can require identity proofs.",
  NullifierMismatch: "This proof is not from the identity registered for the beneficiary.",
  AgeNotProven: "The proof did not show that the beneficiary is over 18.",
};

export function humanError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "Request rejected in wallet.";
    const rev = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = rev?.data?.errorName;
    if (name) return MESSAGES[name] ?? name;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
