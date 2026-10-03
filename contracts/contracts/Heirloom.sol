// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Heirloom v2 - trust-minimized digital inheritance
/// @notice The chain holds only ciphertext pointers, hashes, public keys and ECIES-encrypted key shares.
///         No plaintext, no private keys, no PII.
contract Heirloom is ReentrancyGuard {
    // ------------------------------------------------------------------ types

    enum ClaimStatus { None, Raised, Cancelled, Finalized, Rejected }
    enum EvidenceType { Death, Incapacity, Any }
    enum Response { None, Attested, Rejected }

    struct Policy {
        uint8 requiredApprovals; // guardian approvals needed before attestationDeadline
        uint64 challengePeriod; // seconds after raisedAt during which the owner can still object
        uint64 minInactivity; // seconds of owner silence required before a claim may be raised
        uint64 unlockAfter; // absolute timestamp; 0 = no time lock
        EvidenceType evidenceType; // Any accepts Death or Incapacity claims
        uint64 attestationDeadline; // seconds after raisedAt; afterwards the vault threshold suffices
    }

    struct Vault {
        address owner;
        uint8 threshold; // Shamir threshold; also the approvals floor once attestationDeadline has passed
        bool frozen;
        uint64 heartbeatInterval;
        uint64 lastHeartbeat;
        uint32 epoch; // bumped when guardians rotate; assets must be re-shared to the new epoch
        address[] guardians;
    }

    struct Asset {
        uint256 id;
        address owner;
        address beneficiary;
        string storageId;
        bytes32 contentHash;
        bytes[] encShares; // encShares[i] is ECIES-encrypted to guardians[i]'s registered key
        bytes ownerWrappedKey; // DEK ECIES-wrapped to the owner's registered key
        Policy policy;
        uint32 sharesEpoch;
        uint256 activeClaim; // latest claim id, 0 = none
        bool released; // a claim was finalized; shares are no longer changeable
    }

    struct Claim {
        uint256 assetId;
        address claimant;
        uint64 raisedAt;
        EvidenceType evidenceType;
        bytes32 evidenceHash;
        string evidenceStorageId;
        uint8 approvals;
        uint8 rejections;
        ClaimStatus status;
        bool flagged; // a guardian flagged fraud: the claim can never finalize
        address[] guardians; // snapshot of the vault guardians when the claim was raised
    }

    // ------------------------------------------------------------------ storage

    uint64 public constant MIN_PERIOD = 5 minutes;
    uint8 public constant MIN_GUARDIANS = 3;
    uint8 public constant MAX_GUARDIANS = 7;

    mapping(address => bytes) private encryptionKeys;
    mapping(address => Vault) private vaults;
    mapping(address => bool) public hasVault;

    Asset[] private assets;
    mapping(address => uint256[]) private ownerAssets;
    mapping(address => uint256[]) private beneficiaryAssets;

    mapping(uint256 => Claim) private claims; // claim ids start at 1
    uint256 public claimCount;
    mapping(address => uint256[]) private guardianClaims;
    mapping(uint256 => mapping(address => Response)) private responses;
    mapping(uint256 => mapping(address => bool)) private fraudFlagged;
    mapping(uint256 => mapping(uint256 => bytes)) private releasedShares; // claimId => guardian index => share

    // ------------------------------------------------------------------ errors

    error InvalidEncryptionKey();
    error NoEncryptionKey(address account);
    error VaultExists();
    error NoVault();
    error InvalidGuardians();
    error InvalidThreshold();
    error PeriodTooShort();
    error InvalidPolicy();
    error InvalidShares();
    error InvalidBeneficiary();
    error EmptyField();
    error NotOwner();
    error NotBeneficiary();
    error NotGuardian();
    error NoSuchAsset();
    error NoSuchClaim();
    error AssetAlreadyReleased();
    error AssetSharesStale();
    error EvidenceTypeMismatch();
    error NotInactiveLongEnough();
    error ClaimAlreadyActive();
    error ClaimNotRaised();
    error ClaimNotFinalized();
    error ClaimInvalidatedByHeartbeat();
    error ClaimFlaggedFraud();
    error AlreadyResponded();
    error AlreadyFlagged();
    error VaultFrozen();
    error VaultNotFrozen();
    error ChallengePeriodNotOver();
    error NotYetUnlocked();
    error NotEnoughApprovals();
    error ShareAlreadyReleased();

    // ------------------------------------------------------------------ events

    event EncryptionKeyRegistered(address indexed account, bytes pubKey);
    event VaultCreated(address indexed owner, address[] guardians, uint8 threshold, uint64 heartbeatInterval);
    event GuardiansRotated(address indexed owner, address[] guardians, uint8 threshold, uint32 epoch);
    event Heartbeat(address indexed owner, uint64 timestamp);
    event PanicFrozen(address indexed owner);
    event VaultUnfrozen(address indexed owner);
    event AssetAdded(uint256 indexed assetId, address indexed owner, address indexed beneficiary, string storageId, bytes32 contentHash);
    event AssetSharesUpdated(uint256 indexed assetId, address indexed owner, uint32 epoch);
    event ClaimRaised(
        uint256 indexed claimId,
        uint256 indexed assetId,
        address indexed claimant,
        EvidenceType evidenceType,
        bytes32 evidenceHash,
        string evidenceStorageId
    );
    event Attested(uint256 indexed claimId, address indexed guardian, uint8 approvals);
    event ClaimRejectedByGuardian(uint256 indexed claimId, address indexed guardian, bytes32 reasonHash, uint8 rejections);
    event ClaimRejected(uint256 indexed claimId); // approvals can no longer reach the threshold
    event FraudFlagged(uint256 indexed claimId, address indexed guardian);
    event ClaimCancelled(uint256 indexed claimId, address indexed owner);
    event ClaimFinalized(uint256 indexed claimId, address indexed by);
    event ShareReleased(uint256 indexed claimId, uint256 guardianIndex, address indexed guardian);

    // ------------------------------------------------------------------ encryption keys

    /// @notice Registers (or replaces) the caller's secp256k1 public key used for ECIES.
    ///         Accepts a 33-byte compressed (02/03) or 65-byte uncompressed (04) key.
    function registerEncryptionKey(bytes calldata pubKey) external nonReentrant {
        uint256 len = pubKey.length;
        bytes1 prefix = len > 0 ? pubKey[0] : bytes1(0);
        bool ok = (len == 33 && (prefix == 0x02 || prefix == 0x03)) || (len == 65 && prefix == 0x04);
        if (!ok) revert InvalidEncryptionKey();
        encryptionKeys[msg.sender] = pubKey;
        emit EncryptionKeyRegistered(msg.sender, pubKey);
    }

    function getEncryptionKey(address account) external view returns (bytes memory) {
        return encryptionKeys[account];
    }

    function hasEncryptionKey(address account) public view returns (bool) {
        return encryptionKeys[account].length != 0;
    }

    // ------------------------------------------------------------------ vault

    function createVault(address[] calldata guardians, uint8 threshold, uint64 heartbeatInterval) external nonReentrant {
        if (hasVault[msg.sender]) revert VaultExists();
        if (!hasEncryptionKey(msg.sender)) revert NoEncryptionKey(msg.sender);
        if (heartbeatInterval < MIN_PERIOD) revert PeriodTooShort();
        Vault storage v = vaults[msg.sender];
        v.owner = msg.sender;
        v.heartbeatInterval = heartbeatInterval;
        v.lastHeartbeat = uint64(block.timestamp);
        hasVault[msg.sender] = true;
        _setGuardians(v, guardians, threshold);
        emit VaultCreated(msg.sender, guardians, threshold, heartbeatInterval);
    }

    /// @notice Replaces the guardian set. Counts as an owner heartbeat (invalidating open claims), bumps the
    ///         epoch, and so blocks new claims on an asset until the owner re-shares it via updateAssetShares.
    function rotateGuardians(address[] calldata guardians, uint8 threshold) external nonReentrant {
        Vault storage v = _ownerVault();
        _setGuardians(v, guardians, threshold);
        v.epoch++;
        _beat(v);
        emit GuardiansRotated(msg.sender, guardians, threshold, v.epoch);
    }

    function heartbeat() external nonReentrant {
        _beat(_ownerVault());
    }

    /// @notice Emergency stop: blocks new claims, attestations and finalization until unfreeze().
    function panicFreeze() external nonReentrant {
        Vault storage v = _ownerVault();
        if (v.frozen) revert VaultFrozen();
        v.frozen = true;
        emit PanicFrozen(msg.sender);
    }

    /// @notice Lifts the freeze. Counts as an owner heartbeat, so claims open at that time are invalidated.
    function unfreeze() external nonReentrant {
        Vault storage v = _ownerVault();
        if (!v.frozen) revert VaultNotFrozen();
        v.frozen = false;
        emit VaultUnfrozen(msg.sender);
        _beat(v);
    }

    // ------------------------------------------------------------------ assets

    function addAsset(
        address beneficiary,
        string calldata storageId,
        bytes32 contentHash,
        bytes[] calldata encShares,
        bytes calldata ownerWrappedKey,
        Policy calldata policy
    ) external nonReentrant returns (uint256 id) {
        Vault storage v = _ownerVault();
        if (beneficiary == address(0) || beneficiary == msg.sender) revert InvalidBeneficiary();
        if (!hasEncryptionKey(beneficiary)) revert NoEncryptionKey(beneficiary);
        if (bytes(storageId).length == 0 || contentHash == bytes32(0) || ownerWrappedKey.length == 0) revert EmptyField();
        _checkShares(v, encShares);
        _checkPolicy(v, policy);

        id = assets.length;
        Asset storage a = assets.push();
        a.id = id;
        a.owner = msg.sender;
        a.beneficiary = beneficiary;
        a.storageId = storageId;
        a.contentHash = contentHash;
        a.encShares = encShares;
        a.ownerWrappedKey = ownerWrappedKey;
        a.policy = policy;
        a.sharesEpoch = v.epoch;
        ownerAssets[msg.sender].push(id);
        beneficiaryAssets[beneficiary].push(id);
        emit AssetAdded(id, msg.sender, beneficiary, storageId, contentHash);
    }

    /// @notice Re-shares an asset to the current guardian set (e.g. after rotateGuardians). Counts as an owner
    ///         heartbeat. Not allowed once a claim on the asset has been finalized.
    function updateAssetShares(uint256 assetId, bytes[] calldata encShares, bytes calldata ownerWrappedKey) external nonReentrant {
        Vault storage v = _ownerVault();
        Asset storage a = _asset(assetId);
        if (a.owner != msg.sender) revert NotOwner();
        if (a.released) revert AssetAlreadyReleased();
        if (ownerWrappedKey.length == 0) revert EmptyField();
        _checkShares(v, encShares);
        a.encShares = encShares;
        a.ownerWrappedKey = ownerWrappedKey;
        a.sharesEpoch = v.epoch;
        emit AssetSharesUpdated(assetId, msg.sender, v.epoch);
        _beat(v);
    }

    // ------------------------------------------------------------------ claims

    function raiseClaim(uint256 assetId, EvidenceType evidenceType, bytes32 evidenceHash, string calldata evidenceStorageId)
        external
        nonReentrant
        returns (uint256 claimId)
    {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.beneficiary) revert NotBeneficiary();
        if (a.released) revert AssetAlreadyReleased();
        Vault storage v = vaults[a.owner];
        if (v.frozen) revert VaultFrozen();
        if (a.sharesEpoch != v.epoch) revert AssetSharesStale();
        if (evidenceType == EvidenceType.Any) revert EvidenceTypeMismatch();
        if (a.policy.evidenceType != EvidenceType.Any && a.policy.evidenceType != evidenceType) revert EvidenceTypeMismatch();
        if (evidenceHash == bytes32(0) || bytes(evidenceStorageId).length == 0) revert EmptyField();

        uint256 required = a.policy.minInactivity > v.heartbeatInterval ? a.policy.minInactivity : v.heartbeatInterval;
        if (block.timestamp - v.lastHeartbeat < required) revert NotInactiveLongEnough();

        if (a.activeClaim != 0) {
            Claim storage prev = claims[a.activeClaim];
            // A live raised claim (even a fraud-flagged one, until the owner cancels it) blocks a new one.
            if (prev.status == ClaimStatus.Raised && v.lastHeartbeat < prev.raisedAt) revert ClaimAlreadyActive();
        }

        claimId = ++claimCount;
        Claim storage c = claims[claimId];
        c.assetId = assetId;
        c.claimant = msg.sender;
        c.raisedAt = uint64(block.timestamp);
        c.evidenceType = evidenceType;
        c.evidenceHash = evidenceHash;
        c.evidenceStorageId = evidenceStorageId;
        c.status = ClaimStatus.Raised;
        c.guardians = v.guardians;
        a.activeClaim = claimId;
        for (uint256 i = 0; i < c.guardians.length; i++) guardianClaims[c.guardians[i]].push(claimId);
        emit ClaimRaised(claimId, assetId, msg.sender, evidenceType, evidenceHash, evidenceStorageId);
    }

    function attest(uint256 claimId) external nonReentrant {
        (Claim storage c, Vault storage v) = _liveClaim(claimId);
        _guardianIndex(c, msg.sender);
        if (c.flagged) revert ClaimFlaggedFraud();
        if (v.frozen) revert VaultFrozen();
        if (responses[claimId][msg.sender] != Response.None) revert AlreadyResponded();
        responses[claimId][msg.sender] = Response.Attested;
        c.approvals++;
        emit Attested(claimId, msg.sender, c.approvals);
    }

    function reject(uint256 claimId, bytes32 reasonHash) external nonReentrant {
        (Claim storage c, Vault storage v) = _liveClaim(claimId);
        _guardianIndex(c, msg.sender);
        if (c.flagged) revert ClaimFlaggedFraud();
        if (responses[claimId][msg.sender] != Response.None) revert AlreadyResponded();
        responses[claimId][msg.sender] = Response.Rejected;
        c.rejections++;
        emit ClaimRejectedByGuardian(claimId, msg.sender, reasonHash, c.rejections);
        // Once too many guardians refuse for the threshold to be reachable, the claim is dead.
        if (c.rejections > c.guardians.length - v.threshold) {
            c.status = ClaimStatus.Rejected;
            emit ClaimRejected(claimId);
        }
    }

    /// @notice A guardian reports the claim as fraudulent. Freezes the claim for good; only the owner can clear
    ///         it (cancelClaim) so a new claim can be raised. Allowed even while the vault is frozen.
    function flagFraud(uint256 claimId) external nonReentrant {
        (Claim storage c,) = _liveClaim(claimId);
        _guardianIndex(c, msg.sender);
        if (fraudFlagged[claimId][msg.sender]) revert AlreadyFlagged();
        fraudFlagged[claimId][msg.sender] = true;
        c.flagged = true;
        emit FraudFlagged(claimId, msg.sender);
    }

    function cancelClaim(uint256 claimId) external nonReentrant {
        Claim storage c = _claim(claimId);
        if (assets[c.assetId].owner != msg.sender) revert NotOwner();
        if (c.status != ClaimStatus.Raised) revert ClaimNotRaised();
        c.status = ClaimStatus.Cancelled;
        emit ClaimCancelled(claimId, msg.sender);
    }

    /// @notice Permissionless: finalizing only records that every condition already holds.
    function finalizeClaim(uint256 claimId) external nonReentrant {
        Claim storage c = _claim(claimId);
        Asset storage a = assets[c.assetId];
        Vault storage v = vaults[a.owner];
        if (c.status != ClaimStatus.Raised) revert ClaimNotRaised();
        if (c.flagged) revert ClaimFlaggedFraud();
        if (v.frozen) revert VaultFrozen();
        if (v.lastHeartbeat >= c.raisedAt) revert ClaimInvalidatedByHeartbeat();
        if (block.timestamp < uint256(c.raisedAt) + a.policy.challengePeriod) revert ChallengePeriodNotOver();
        if (block.timestamp < a.policy.unlockAfter) revert NotYetUnlocked();

        // Unresponsive guardians must not block inheritance forever: after the attestation deadline the
        // Shamir threshold is enough, since that is all that is needed to reconstruct the key anyway.
        bool pastDeadline = block.timestamp >= uint256(c.raisedAt) + a.policy.attestationDeadline;
        uint8 needed = pastDeadline ? v.threshold : a.policy.requiredApprovals;
        if (c.approvals < needed) revert NotEnoughApprovals();

        c.status = ClaimStatus.Finalized;
        a.released = true;
        emit ClaimFinalized(claimId, msg.sender);
    }

    /// @notice A guardian publishes their share, decrypted and re-encrypted to the beneficiary's key.
    function submitShare(uint256 claimId, bytes calldata reEncryptedShare) external nonReentrant {
        Claim storage c = _claim(claimId);
        if (c.status != ClaimStatus.Finalized) revert ClaimNotFinalized();
        uint256 idx = _guardianIndex(c, msg.sender);
        if (reEncryptedShare.length == 0) revert EmptyField();
        if (releasedShares[claimId][idx].length != 0) revert ShareAlreadyReleased();
        releasedShares[claimId][idx] = reEncryptedShare;
        emit ShareReleased(claimId, idx, msg.sender);
    }

    // ------------------------------------------------------------------ views

    function getVault(address owner) external view returns (Vault memory) {
        return vaults[owner];
    }

    function assetCount() external view returns (uint256) {
        return assets.length;
    }

    function getAsset(uint256 assetId) external view returns (Asset memory) {
        return _asset(assetId);
    }

    function getClaim(uint256 claimId) external view returns (Claim memory) {
        return _claim(claimId);
    }

    /// @notice True when the owner has been active since the claim was raised (the claim can no longer finalize).
    function isClaimInvalidated(uint256 claimId) external view returns (bool) {
        Claim storage c = _claim(claimId);
        return vaults[assets[c.assetId].owner].lastHeartbeat >= c.raisedAt;
    }

    function getResponse(uint256 claimId, address guardian) external view returns (Response attestation, bool flaggedFraud) {
        _claim(claimId);
        return (responses[claimId][guardian], fraudFlagged[claimId][guardian]);
    }

    /// @notice Entry i is the share released by guardians[i] of the claim's snapshot ("" if not yet released).
    function getReleasedShares(uint256 claimId) external view returns (bytes[] memory out) {
        Claim storage c = _claim(claimId);
        out = new bytes[](c.guardians.length);
        for (uint256 i = 0; i < out.length; i++) out[i] = releasedShares[claimId][i];
    }

    function assetsByOwner(address owner) external view returns (uint256[] memory) {
        return ownerAssets[owner];
    }

    function assetsByBeneficiary(address beneficiary) external view returns (uint256[] memory) {
        return beneficiaryAssets[beneficiary];
    }

    function claimsByGuardian(address guardian) external view returns (uint256[] memory) {
        return guardianClaims[guardian];
    }

    // ------------------------------------------------------------------ internals

    function _beat(Vault storage v) private {
        v.lastHeartbeat = uint64(block.timestamp);
        emit Heartbeat(v.owner, uint64(block.timestamp));
    }

    function _ownerVault() private view returns (Vault storage v) {
        if (!hasVault[msg.sender]) revert NoVault();
        v = vaults[msg.sender];
    }

    function _asset(uint256 assetId) private view returns (Asset storage) {
        if (assetId >= assets.length) revert NoSuchAsset();
        return assets[assetId];
    }

    function _claim(uint256 claimId) private view returns (Claim storage) {
        if (claimId == 0 || claimId > claimCount) revert NoSuchClaim();
        return claims[claimId];
    }

    /// @dev A claim that can still be responded to: raised and not invalidated by an owner heartbeat.
    function _liveClaim(uint256 claimId) private view returns (Claim storage c, Vault storage v) {
        c = _claim(claimId);
        if (c.status != ClaimStatus.Raised) revert ClaimNotRaised();
        v = vaults[assets[c.assetId].owner];
        if (v.lastHeartbeat >= c.raisedAt) revert ClaimInvalidatedByHeartbeat();
    }

    function _guardianIndex(Claim storage c, address who) private view returns (uint256) {
        for (uint256 i = 0; i < c.guardians.length; i++) if (c.guardians[i] == who) return i;
        revert NotGuardian();
    }

    function _setGuardians(Vault storage v, address[] calldata guardians, uint8 threshold) private {
        uint256 n = guardians.length;
        if (n < MIN_GUARDIANS || n > MAX_GUARDIANS) revert InvalidGuardians();
        if (threshold < 2 || threshold > n) revert InvalidThreshold();
        for (uint256 i = 0; i < n; i++) {
            address g = guardians[i];
            if (g == address(0) || g == v.owner) revert InvalidGuardians();
            if (!hasEncryptionKey(g)) revert NoEncryptionKey(g);
            for (uint256 j = 0; j < i; j++) if (guardians[j] == g) revert InvalidGuardians();
        }
        v.guardians = guardians;
        v.threshold = threshold;
    }

    function _checkShares(Vault storage v, bytes[] calldata encShares) private view {
        if (encShares.length != v.guardians.length) revert InvalidShares();
        for (uint256 i = 0; i < encShares.length; i++) if (encShares[i].length == 0) revert InvalidShares();
    }

    function _checkPolicy(Vault storage v, Policy calldata p) private view {
        if (p.challengePeriod < MIN_PERIOD || p.minInactivity < MIN_PERIOD || p.attestationDeadline < MIN_PERIOD) revert PeriodTooShort();
        if (p.requiredApprovals < v.threshold || p.requiredApprovals > v.guardians.length) revert InvalidPolicy();
        if (p.unlockAfter != 0 && p.unlockAfter <= block.timestamp) revert InvalidPolicy();
    }
}
