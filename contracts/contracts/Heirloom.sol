// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IAnonAadhaar} from "@anon-aadhaar/contracts/interfaces/IAnonAadhaar.sol";

/// @title Heirloom v2 - trust-minimized digital inheritance
/// @notice The chain holds only ciphertext pointers, hashes, public keys and ECIES-encrypted key shares.
///         No plaintext, no private keys, no PII.
/// @dev Crypto assets: an asset can instead hold native currency or one ERC-20. The same policy and claim rules apply, but there is no
///      key to release: finalizing a claim only makes the funds withdrawable, and the beneficiary pulls them with withdraw().
///      Optional identity layer: Anon Aadhaar zero-knowledge proofs ("this person holds a valid Aadhaar", and optionally
///      "is over 18") bound to a per-app nullifier. Only the nullifier, a pseudonym that is the same for one person in
///      this app and unlinkable to their Aadhaar, is ever stored. No Aadhaar data, no date of birth.
contract Heirloom is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ types

    enum AssetKind { Data, Crypto }
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
        bool requireBeneficiaryZK; // raiseClaim needs a fresh ZK proof by the beneficiary's registered identity
        bool requireAge18; // finalizeClaim needs a ZK proof that the beneficiary is over 18 (no date of birth is stored)
    }

    /// @notice An Anon Aadhaar proof as the verifier takes it. The seed and signal are NOT supplied by the caller:
    ///         the contract fixes the seed and derives the signal, which is what binds a proof to one use.
    struct ZkProof {
        uint256 nullifier;
        uint256 timestamp; // when the Aadhaar QR was signed (rounded down to the hour)
        uint256[4] revealArray; // [ageAbove18, gender, pincode, state]; 0 where the field was not revealed
        uint256[8] groth16Proof;
    }

    struct Vault {
        address owner;
        uint8 threshold; // Shamir threshold; also the approvals floor once attestationDeadline has passed
        bool frozen;
        uint64 heartbeatInterval;
        uint64 lastHeartbeat;
        uint32 epoch; // bumped when guardians rotate; assets must be re-shared to the new epoch
        bool requireVerifiedGuardians; // every guardian must hold a verified identity, one person per guardian
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
        AssetKind kind;
        address token; // Crypto only: address(0) = native currency, otherwise an ERC-20
        uint256 balance; // Crypto only: what is locked in this asset (credited with what actually arrived)
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
    /// @dev The verifier does not check proof age, so Heirloom does. QR timestamps are rounded down to the hour.
    uint64 public constant MAX_PROOF_AGE = 3 hours;
    uint256 private constant SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617;
    bytes32 private constant IDENTITY_DOMAIN = keccak256("heirloom.identity.v1");
    bytes32 private constant CLAIM_DOMAIN = keccak256("heirloom.claim.v1");
    bytes32 private constant AGE_DOMAIN = keccak256("heirloom.age18.v1");
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

    // Identity (Anon Aadhaar). The verifier may be address(0) on chains without one; identity features then revert.
    IAnonAadhaar public immutable verifier;
    /// @notice App-specific seed the nullifier is derived from: the same person gets the same nullifier here, and an
    ///         unrelated one in any other app.
    uint256 public immutable nullifierSeed;
    mapping(uint256 => address) public nullifierOwner; // nullifier => the one address bound to it
    mapping(address => uint256) public nullifierOf; // address => its nullifier (0 = not verified)

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
    error WrongAssetKind();
    error ZeroAmount();
    error InvalidToken();
    error WrongValue();
    error UnexpectedValue();
    error ClaimActive();
    error NotReleased();
    error NothingToWithdraw();
    error EmptyAsset();
    error InsufficientBalance();
    error TransferFailed();
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
    error IdentityDisabled();
    error InvalidSeed();
    error InvalidProof();
    error StaleProof();
    error AlreadyVerified();
    error NullifierAlreadyUsed();
    error GuardianNotVerified(address guardian);
    error BeneficiaryNotVerified(address beneficiary);
    error NullifierMismatch();
    error AgeNotProven();

    // ------------------------------------------------------------------ events

    event EncryptionKeyRegistered(address indexed account, bytes pubKey);
    event VaultCreated(address indexed owner, address[] guardians, uint8 threshold, uint64 heartbeatInterval, bool requireVerifiedGuardians);
    event GuardiansRotated(address indexed owner, address[] guardians, uint8 threshold, uint32 epoch, bool requireVerifiedGuardians);
    /// @notice Binds an address to a verified, unique person. The nullifier is a per-app pseudonym; no personal data.
    event IdentityVerified(address indexed account, uint256 nullifier);
    event Heartbeat(address indexed owner, uint64 timestamp);
    event PanicFrozen(address indexed owner);
    event VaultUnfrozen(address indexed owner);
    event AssetAdded(uint256 indexed assetId, address indexed owner, address indexed beneficiary, string storageId, bytes32 contentHash);
    event AssetSharesUpdated(uint256 indexed assetId, address indexed owner, uint32 epoch);
    /// @notice A crypto asset received funds (its first deposit, and every top-up). `amount` is what actually arrived.
    event CryptoDeposited(uint256 indexed assetId, address indexed token, uint256 amount, uint256 balance);
    /// @notice The owner took funds back out before any claim. `balance` is what remains locked.
    event CryptoWithdrawn(uint256 indexed assetId, address indexed to, address indexed token, uint256 amount, uint256 balance);
    /// @notice The beneficiary pulled the funds after the claim was finalized.
    event CryptoClaimed(uint256 indexed assetId, address indexed beneficiary, address indexed token, uint256 amount);
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

    /// @param verifier_ The Anon Aadhaar verifier (address(0) disables the identity features).
    /// @param nullifierSeed_ This app's nullifier seed. Must be a non-zero field element.
    constructor(IAnonAadhaar verifier_, uint256 nullifierSeed_) {
        if (nullifierSeed_ == 0 || nullifierSeed_ >= SNARK_FIELD) revert InvalidSeed();
        verifier = verifier_;
        nullifierSeed = nullifierSeed_;
    }

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

    function createVault(address[] calldata guardians, uint8 threshold, uint64 heartbeatInterval, bool requireVerifiedGuardians) external nonReentrant {
        if (hasVault[msg.sender]) revert VaultExists();
        if (!hasEncryptionKey(msg.sender)) revert NoEncryptionKey(msg.sender);
        if (heartbeatInterval < MIN_PERIOD) revert PeriodTooShort();
        Vault storage v = vaults[msg.sender];
        v.owner = msg.sender;
        v.heartbeatInterval = heartbeatInterval;
        v.lastHeartbeat = uint64(block.timestamp);
        hasVault[msg.sender] = true;
        _setGuardians(v, guardians, threshold);
        _applyGuardianPolicy(v, guardians, requireVerifiedGuardians);
        emit VaultCreated(msg.sender, guardians, threshold, heartbeatInterval, requireVerifiedGuardians);
    }

    /// @notice Replaces the guardian set. Counts as an owner heartbeat (invalidating open claims), bumps the
    ///         epoch, and so blocks new claims on an asset until the owner re-shares it via updateAssetShares.
    function rotateGuardians(address[] calldata guardians, uint8 threshold, bool requireVerifiedGuardians) external nonReentrant {
        Vault storage v = _ownerVault();
        _setGuardians(v, guardians, threshold);
        _applyGuardianPolicy(v, guardians, requireVerifiedGuardians);
        v.epoch++;
        _beat(v);
        emit GuardiansRotated(msg.sender, guardians, threshold, v.epoch, requireVerifiedGuardians);
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
        _checkIdentityPolicy(beneficiary, policy);

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

    // ------------------------------------------------------------------ crypto assets

    /// @notice Creates a crypto asset holding native currency (token = address(0), send `amount` as msg.value) or an ERC-20
    ///         (approve this contract first). It follows the same policy and claim rules as any asset, but carries no encrypted
    ///         data: a finalized claim makes the funds withdrawable by the beneficiary.
    function addCryptoAsset(address beneficiary, address token, uint256 amount, Policy calldata policy)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        Vault storage v = _ownerVault();
        if (beneficiary == address(0) || beneficiary == msg.sender) revert InvalidBeneficiary();
        if (amount == 0) revert ZeroAmount();
        _checkPolicy(v, policy);
        _checkIdentityPolicy(beneficiary, policy);

        id = assets.length;
        Asset storage a = assets.push();
        a.id = id;
        a.owner = msg.sender;
        a.beneficiary = beneficiary;
        a.policy = policy;
        a.sharesEpoch = v.epoch;
        a.kind = AssetKind.Crypto;
        a.token = token;
        ownerAssets[msg.sender].push(id);
        beneficiaryAssets[beneficiary].push(id);
        emit AssetAdded(id, msg.sender, beneficiary, "", bytes32(0));

        uint256 received = _pull(token, amount); // the only external call that can move value in
        if (received == 0) revert ZeroAmount();
        a.balance = received;
        emit CryptoDeposited(id, token, received, received);
    }

    /// @notice Adds funds (the same token) to a crypto asset. Not while a claim is open and not after release.
    function topUp(uint256 assetId, uint256 amount) external payable nonReentrant {
        Asset storage a = _ownerCryptoAsset(assetId);
        _requireUnclaimed(a);
        if (amount == 0) revert ZeroAmount();
        uint256 received = _pull(a.token, amount);
        if (received == 0) revert ZeroAmount();
        a.balance += received;
        emit CryptoDeposited(assetId, a.token, received, a.balance);
    }

    /// @notice Takes funds back out. Not while a claim is open (cancel it first) and not after release.
    function ownerWithdraw(uint256 assetId, uint256 amount) external nonReentrant {
        Asset storage a = _ownerCryptoAsset(assetId);
        _requireUnclaimed(a);
        if (amount == 0) revert ZeroAmount();
        if (amount > a.balance) revert InsufficientBalance();
        a.balance -= amount; // effects before the transfer
        _send(a.token, msg.sender, amount);
        emit CryptoWithdrawn(assetId, msg.sender, a.token, amount, a.balance);
    }

    /// @notice The beneficiary pulls everything locked in the asset once a claim on it has been finalized.
    function withdraw(uint256 assetId) external nonReentrant {
        Asset storage a = _asset(assetId);
        if (a.kind != AssetKind.Crypto) revert WrongAssetKind();
        if (msg.sender != a.beneficiary) revert NotBeneficiary();
        if (!a.released) revert NotReleased();
        uint256 amount = a.balance;
        if (amount == 0) revert NothingToWithdraw();
        a.balance = 0; // effects before the transfer: a reentrant call finds nothing left
        _send(a.token, msg.sender, amount);
        emit CryptoClaimed(assetId, msg.sender, a.token, amount);
    }

    /// @notice Re-shares an asset to the current guardian set (e.g. after rotateGuardians). Counts as an owner
    ///         heartbeat. Not allowed once a claim on the asset has been finalized.
    function updateAssetShares(uint256 assetId, bytes[] calldata encShares, bytes calldata ownerWrappedKey) external nonReentrant {
        Vault storage v = _ownerVault();
        Asset storage a = _asset(assetId);
        if (a.owner != msg.sender) revert NotOwner();
        if (a.kind != AssetKind.Data) revert WrongAssetKind(); // crypto assets have no shares
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

    function raiseClaim(uint256 assetId, EvidenceType evidenceType, bytes32 evidenceHash, string calldata evidenceStorageId, ZkProof calldata proof)
        external
        nonReentrant
        returns (uint256 claimId)
    {
        Asset storage a = _asset(assetId);
        if (msg.sender != a.beneficiary) revert NotBeneficiary();
        if (a.released) revert AssetAlreadyReleased();
        Vault storage v = vaults[a.owner];
        if (v.frozen) revert VaultFrozen();
        if (a.kind == AssetKind.Data) {
            if (a.sharesEpoch != v.epoch) revert AssetSharesStale();
        } else if (a.balance == 0) {
            revert EmptyAsset(); // nothing to inherit: a claim would only be noise
        }
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

        // A fresh proof by the beneficiary's registered identity, bound to the id this claim is about to get and to the caller.
        if (a.policy.requireBeneficiaryZK) _requireBeneficiaryProof(proof, CLAIM_DOMAIN, claimCount + 1, a.beneficiary);

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
    function finalizeClaim(uint256 claimId, ZkProof calldata proof) external nonReentrant {
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

        if (a.policy.requireAge18) {
            // Anyone may relay it, but the proof is the beneficiary's: right identity, this claim only, over 18 revealed.
            _requireBeneficiaryProof(proof, AGE_DOMAIN, claimId, a.beneficiary);
            if (proof.revealArray[0] != 1) revert AgeNotProven();
        }

        c.status = ClaimStatus.Finalized;
        a.released = true;
        emit ClaimFinalized(claimId, msg.sender);
    }

    /// @notice A guardian publishes their share, decrypted and re-encrypted to the beneficiary's key.
    function submitShare(uint256 claimId, bytes calldata reEncryptedShare) external nonReentrant {
        Claim storage c = _claim(claimId);
        if (c.status != ClaimStatus.Finalized) revert ClaimNotFinalized();
        if (assets[c.assetId].kind != AssetKind.Data) revert WrongAssetKind(); // crypto has no share to release
        uint256 idx = _guardianIndex(c, msg.sender);
        if (reEncryptedShare.length == 0) revert EmptyField();
        if (releasedShares[claimId][idx].length != 0) revert ShareAlreadyReleased();
        releasedShares[claimId][idx] = reEncryptedShare;
        emit ShareReleased(claimId, idx, msg.sender);
    }

    // ------------------------------------------------------------------ identity

    /// @notice Registers the caller as a verified, unique person. One nullifier per address and one address per
    ///         nullifier, so a person cannot hold two verified wallets. The signal binds the proof to msg.sender, so
    ///         nobody can take a proof from the mempool and register it for themselves.
    function verifyIdentity(ZkProof calldata proof) external nonReentrant {
        if (address(verifier) == address(0)) revert IdentityDisabled();
        if (nullifierOf[msg.sender] != 0) revert AlreadyVerified();
        if (proof.nullifier == 0) revert InvalidProof();
        if (nullifierOwner[proof.nullifier] != address(0)) revert NullifierAlreadyUsed();
        _checkProof(proof, identitySignal(msg.sender));
        nullifierOf[msg.sender] = proof.nullifier;
        nullifierOwner[proof.nullifier] = msg.sender;
        emit IdentityVerified(msg.sender, proof.nullifier);
    }

    function isVerified(address account) external view returns (bool) {
        return nullifierOf[account] != 0;
    }

    /// @notice The signals a proof must have been generated with. The browser computes the same values.
    function identitySignal(address who) public view returns (uint256) {
        return _signal(IDENTITY_DOMAIN, 0, who);
    }

    function claimSignal(uint256 claimId, address who) public view returns (uint256) {
        return _signal(CLAIM_DOMAIN, claimId, who);
    }

    function ageSignal(uint256 claimId, address who) public view returns (uint256) {
        return _signal(AGE_DOMAIN, claimId, who);
    }

    function _signal(bytes32 domain, uint256 id, address who) private view returns (uint256) {
        // Domain-separated, so a proof made for one purpose can never be replayed for another, nor on another chain
        // or contract.
        return uint256(keccak256(abi.encode(domain, block.chainid, address(this), id, who)));
    }

    function _checkProof(ZkProof calldata p, uint256 signal) private view {
        if (address(verifier) == address(0)) revert IdentityDisabled();
        // The verifier only checks the cryptography. Freshness is ours: proof of access to the QR within the last hours.
        if (p.timestamp > block.timestamp || block.timestamp - p.timestamp > MAX_PROOF_AGE) revert StaleProof();
        try verifier.verifyAnonAadhaarProof(nullifierSeed, p.nullifier, p.timestamp, signal, p.revealArray, p.groth16Proof) returns (bool ok) {
            if (!ok) revert InvalidProof();
        } catch {
            revert InvalidProof();
        }
    }

    /// @dev The proof must be by the beneficiary's registered identity and made for this claim and this use only.
    function _requireBeneficiaryProof(ZkProof calldata p, bytes32 domain, uint256 claimId, address beneficiary) private view {
        if (p.nullifier != nullifierOf[beneficiary] || p.nullifier == 0) revert NullifierMismatch();
        _checkProof(p, _signal(domain, claimId, beneficiary));
    }

    function _applyGuardianPolicy(Vault storage v, address[] calldata guardians, bool requireVerified) private {
        v.requireVerifiedGuardians = requireVerified;
        if (!requireVerified) return;
        if (address(verifier) == address(0)) revert IdentityDisabled();
        uint256 n = guardians.length;
        uint256[] memory seen = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = nullifierOf[guardians[i]];
            if (id == 0) revert GuardianNotVerified(guardians[i]);
            // Distinct addresses already have distinct nullifiers, but state the rule where it matters.
            for (uint256 j = 0; j < i; j++) if (seen[j] == id) revert GuardianNotVerified(guardians[i]);
            seen[i] = id;
        }
    }

    function _checkIdentityPolicy(address beneficiary, Policy calldata p) private view {
        if (!p.requireBeneficiaryZK && !p.requireAge18) return;
        if (address(verifier) == address(0)) revert IdentityDisabled();
        // The proofs later have to match this nullifier, so it must exist now.
        if (nullifierOf[beneficiary] == 0) revert BeneficiaryNotVerified(beneficiary);
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

    function _ownerCryptoAsset(uint256 assetId) private view returns (Asset storage a) {
        a = _asset(assetId);
        if (a.owner != msg.sender) revert NotOwner();
        if (a.kind != AssetKind.Crypto) revert WrongAssetKind();
    }

    /// @dev Funds can only be moved by the owner while nobody has a claim on them. "A claim is open" means status Raised,
    ///      even if a later check-in has voided it: the owner cancels it explicitly, which is on the record.
    function _requireUnclaimed(Asset storage a) private view {
        if (a.released) revert AssetAlreadyReleased();
        if (a.activeClaim != 0 && claims[a.activeClaim].status == ClaimStatus.Raised) revert ClaimActive();
    }

    /// @dev Takes `amount` from the caller. Native: it must equal msg.value. ERC-20: transferred in, and what is credited is
    ///      what actually arrived, so fee-on-transfer tokens cannot make the books exceed the real balance.
    function _pull(address token, uint256 amount) private returns (uint256 received) {
        if (token == address(0)) {
            if (msg.value != amount) revert WrongValue();
            return amount;
        }
        if (msg.value != 0) revert UnexpectedValue();
        if (token.code.length == 0) revert InvalidToken();
        IERC20 t = IERC20(token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        received = t.balanceOf(address(this)) - before;
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
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
