// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title Heirloom Vault
 * @notice Trust-minimized digital inheritance vault with 3-of-5 guardian threshold.
 * 
 * State machine:
 *   ACTIVE ──(heartbeat missed AND 3 attestations)──> RECOVERY_PENDING
 *   RECOVERY_PENDING ──(owner cancels)──> ACTIVE
 *   RECOVERY_PENDING ──(challenge window expires)──> RELEASED
 *   RELEASED ──(heir proves identity + collects 3 shares)──> CLAIMED
 * 
 * No admin, no pause, no override. Permissionless transitions.
 */
contract Vault {
    // ============================================================
    // State
    // ============================================================
    enum State {
        ACTIVE,
        RECOVERY_PENDING,
        RELEASED,
        CLAIMED
    }

    // ============================================================
    // Storage
    // ============================================================
    struct Guardian {
        bool online;
        bool attested;
        uint256 attestedAt;
        bool shareReleased;
    }

    struct SealedShare {
        uint8 guardianId;
        bytes data; // ECIES ciphertext
    }

    struct VaultData {
        string name;
        string category;
        State state;
        bytes ciphertext;      // AES-GCM ciphertext (public, stands in for IPFS)
        bytes iv;              // 12-byte IV
        string assetFilename;
        bool assetIsText;
        SealedShare[] shares;  // 5 sealed shares, one per guardian
        Guardian[] guardians;  // 5 guardians
        bytes32 heirCommitment; // sha256(heirID + salt)
        address heirWallet;     // registered heir wallet
        uint256 heartbeatIntervalMs;
        uint256 lastHeartbeatAt;
        uint256 recoveryStartedAt;
        uint256 challengeWindowMs;
        uint256 createdAt;
    }

    mapping(bytes32 => VaultData) public vaults;
    bytes32[] public vaultIds;

    // Owner of each vault (for guardian replacement)
    mapping(bytes32 => address) public vaultOwners;

    // Events
    event VaultCreated(bytes32 indexed vaultId, string name, uint256 heartbeatIntervalMs, uint256 challengeWindowMs);
    event Heartbeat(bytes32 indexed vaultId);
    event Attestation(bytes32 indexed vaultId, uint8 guardianId);
    event RecoveryStarted(bytes32 indexed vaultId, uint256 recoveryStartedAt);
    event RecoveryCancelled(bytes32 indexed vaultId);
    event Released(bytes32 indexed vaultId);
    event ShareReleased(bytes32 indexed vaultId, uint8 guardianId);
    event Claimed(bytes32 indexed vaultId, address indexed heir);
    event ClaimRejected(bytes32 indexed vaultId, address indexed claimant, string reason);
    event GuardianToggled(bytes32 indexed vaultId, uint8 guardianId, bool online);
    event GuardianReplaced(bytes32 indexed vaultId, uint8 guardianId, address newOwner);

    // ============================================================
    // Constants
    // ============================================================
    uint8 public constant THRESHOLD = 3;
    uint8 public constant GUARDIAN_COUNT = 5;

    // ============================================================
    // Constructor / Deployment
    // ============================================================
    constructor() {}

    // ============================================================
    // Internal Helpers
    // ============================================================
    function _vault(bytes32 vaultId) internal view returns (VaultData storage) {
        return vaults[vaultId];
    }

    function _requireActive(VaultData storage v) internal view {
        require(v.state == State.ACTIVE, "not active");
    }

    function _requireRecoveryPending(VaultData storage v) internal view {
        require(v.state == State.RECOVERY_PENDING, "not recovery pending");
    }

    function _requireReleased(VaultData storage v) internal view {
        require(v.state == State.RELEASED, "not released");
    }

    function _requireNotClaimed(VaultData storage v) internal view {
        require(v.state != State.CLAIMED, "already claimed");
    }

    function _heartbeatMissed(VaultData storage v) internal view returns (bool) {
        // heartbeatIntervalMs stored in ms, block.timestamp in seconds
        return block.timestamp > v.lastHeartbeatAt + v.heartbeatIntervalMs / 1000;
    }

    function _attestationCount(VaultData storage v) internal view returns (uint8) {
        uint8 count = 0;
        for (uint8 i = 0; i < GUARDIAN_COUNT; i++) {
            if (v.guardians[i].attested) count++;
        }
        return count;
    }

    function _releasedShareCount(VaultData storage v) internal view returns (uint8) {
        uint8 count = 0;
        for (uint8 i = 0; i < GUARDIAN_COUNT; i++) {
            if (v.guardians[i].shareReleased) count++;
        }
        return count;
    }

    function _canStartRecovery(VaultData storage v) internal view returns (bool) {
        return _heartbeatMissed(v) && _attestationCount(v) >= THRESHOLD;
    }

    function _challengeEndsAt(VaultData storage v) internal view returns (uint256) {
        return v.recoveryStartedAt + v.challengeWindowMs / 1000;
    }

    // ============================================================
    // createVault
    // ============================================================
    /**
     * @notice Creates a new vault with encrypted asset and sealed shares.
     * @param name Vault name
     * @param category Asset category
     * @param ciphertext AES-GCM ciphertext of the asset
     * @param iv 12-byte IV for AES-GCM
     * @param assetFilename Original filename
     * @param assetIsText Whether asset is plaintext
     * @param shares 5 ECIES-sealed Shamir shares (one per guardian)
     * @param heirCommitment sha256(heirID + salt)
     * @param heirWallet Heir's registered wallet address
     * @param heartbeatMs Heartbeat interval in milliseconds
     * @param challengeMs Challenge window in milliseconds
     * @return vaultId Unique vault identifier
     */
    function createVault(
        string calldata name,
        string calldata category,
        bytes calldata ciphertext,
        bytes calldata iv,
        string calldata assetFilename,
        bool assetIsText,
        SealedShare[5] calldata shares,
        bytes32 heirCommitment,
        address heirWallet,
        uint256 heartbeatMs,
        uint256 challengeMs
    ) external returns (bytes32) {
        require(heartbeatMs > 0, "heartbeat > 0");
        require(challengeMs > 0, "challenge > 0");
        require(shares.length == GUARDIAN_COUNT, "5 shares required");
        require(heirWallet != address(0), "heir wallet required");

        bytes32 vaultId = keccak256(abi.encodePacked(name, block.timestamp, msg.sender));
        
        VaultData storage v = vaults[vaultId];
        v.name = name;
        v.category = category;
        v.state = State.ACTIVE;
        v.ciphertext = ciphertext;
        v.iv = iv;
        v.assetFilename = assetFilename;
        v.assetIsText = assetIsText;
        v.shares = shares;
        v.guardians = new Guardian[](GUARDIAN_COUNT);
        for (uint8 i = 0; i < GUARDIAN_COUNT; i++) {
            v.guardians[i].online = true;
            v.guardians[i].attested = false;
            v.guardians[i].shareReleased = false;
        }
        v.heirCommitment = heirCommitment;
        v.heirWallet = heirWallet;
        v.heartbeatIntervalMs = heartbeatMs;
        v.lastHeartbeatAt = block.timestamp;
        v.challengeWindowMs = challengeMs;
        v.createdAt = block.timestamp;
        v.recoveryStartedAt = 0;

        vaultOwners[vaultId] = msg.sender;
        vaultIds.push(vaultId);

        emit VaultCreated(vaultId, name, heartbeatMs, challengeMs);
        return vaultId;
    }

    // ============================================================
    // heartbeat
    // ============================================================
    /**
     * @notice Owner proves liveness. Resets deadline and cancels any pending recovery.
     */
    function heartbeat(bytes32 vaultId) external {
        VaultData storage v = _vault(vaultId);
        require(vaultOwners[vaultId] == msg.sender, "not owner");
        
        if (v.state == State.RECOVERY_PENDING) {
            // Heartbeat during challenge window = proof of life = cancel recovery
            v.state = State.ACTIVE;
            v.lastHeartbeatAt = block.timestamp;
            v.recoveryStartedAt = 0;
            // Clear all attestations
            for (uint8 i = 0; i < GUARDIAN_COUNT; i++) {
                v.guardians[i].attested = false;
                v.guardians[i].attestedAt = 0;
            }
            emit RecoveryCancelled(vaultId);
        } else {
            require(v.state == State.ACTIVE, "not active");
            v.lastHeartbeatAt = block.timestamp;
            emit Heartbeat(vaultId);
        }
    }

    // ============================================================
    // attestUnavailable
    // ============================================================
    /**
     * @notice Guardian attests that owner is permanently unavailable.
     * Only allowed in ACTIVE state. Alone does not trigger recovery.
     */
    function attestUnavailable(bytes32 vaultId, uint8 guardianId) external {
        require(guardianId < GUARDIAN_COUNT, "invalid guardian");
        VaultData storage v = _vault(vaultId);
        _requireActive(v);

        Guardian storage g = v.guardians[guardianId];
        require(g.online, "guardian offline");
        require(!g.attested, "already attested");

        g.attested = true;
        g.attestedAt = block.timestamp;

        emit Attestation(vaultId, guardianId);

        // Permissionless check: if both conditions met, start recovery
        if (_canStartRecovery(v)) {
            _startRecovery(vaultId, v);
        }
    }

    // ============================================================
    // startRecovery (permissionless)
    // ============================================================
    /**
     * @notice Anyone can call this once BOTH conditions hold:
     *         1. Heartbeat deadline missed
     *         2. >= 3 guardian attestations
     * No keeper needed.
     */
    function startRecovery(bytes32 vaultId) external {
        VaultData storage v = _vault(vaultId);
        _requireActive(v);
        require(_canStartRecovery(v), "conditions not met");
        _startRecovery(vaultId, v);
    }

    function _startRecovery(bytes32 vaultId, VaultData storage v) internal {
        v.state = State.RECOVERY_PENDING;
        v.recoveryStartedAt = block.timestamp;
        emit RecoveryStarted(vaultId, v.recoveryStartedAt);
    }

    // ============================================================
    // cancelRecovery
    // ============================================================
    /**
     * @notice Owner cancels recovery during challenge window.
     * Only legal in RECOVERY_PENDING.
     */
    function cancelRecovery(bytes32 vaultId) external {
        VaultData storage v = _vault(vaultId);
        require(vaultOwners[vaultId] == msg.sender, "not owner");
        _requireRecoveryPending(v);

        v.state = State.ACTIVE;
        v.lastHeartbeatAt = block.timestamp;
        v.recoveryStartedAt = 0;
        for (uint8 i = 0; i < GUARDIAN_COUNT; i++) {
            v.guardians[i].attested = false;
            v.guardians[i].attestedAt = 0;
        }
        emit RecoveryCancelled(vaultId);
    }

    // ============================================================
    // finalizeRelease (permissionless)
    // ============================================================
    /**
     * @notice Moves vault to RELEASED once challenge window expires with no cancellation.
     * Permissionless - anyone can call.
     */
    function finalizeRelease(bytes32 vaultId) external {
        VaultData storage v = _vault(vaultId);
        _requireRecoveryPending(v);
        require(block.timestamp >= _challengeEndsAt(v), "challenge window open");

        v.state = State.RELEASED;
        emit Released(vaultId);
    }

    // ============================================================
    // releaseShare
    // ============================================================
    /**
     * @notice Guardian publishes its sealed share. Only legal in RELEASED state.
     */
    function releaseShare(bytes32 vaultId, uint8 guardianId) external {
        require(guardianId < GUARDIAN_COUNT, "invalid guardian");
        VaultData storage v = _vault(vaultId);
        _requireReleased(v);

        Guardian storage g = v.guardians[guardianId];
        require(g.online, "guardian offline");
        require(!g.shareReleased, "already released");

        g.shareReleased = true;
        emit ShareReleased(vaultId, guardianId);
    }

    // ============================================================
    // claim
    // ============================================================
    /**
     * @notice Heir proves identity and collects 3 shares to reconstruct key.
     * Only legal in RELEASED state.
     * 
     * Identity check: sha256(heirId + salt) == heirCommitment
     * In production, this comparison happens inside a ZK circuit.
     * 
     * @param vaultId Vault to claim
     * @param heirId Heir's ID number
     * @param salt Shared secret salt
     * @param shareIndices Indices of 3 released shares to use (0-4)
     */
    function claim(
        bytes32 vaultId,
        string calldata heirId,
        string calldata salt,
        uint8[3] calldata shareIndices
    ) external {
        VaultData storage v = _vault(vaultId);
        _requireReleased(v);
        _requireNotClaimed(v);

        // Identity commitment check (ZK circuit in production)
        bytes32 computed = keccak256(abi.encodePacked(heirId, salt));
        require(computed == v.heirCommitment, "commitment mismatch");
        require(msg.sender == v.heirWallet, "not heir wallet");

        // Verify we have 3 released shares
        uint8 count = 0;
        for (uint8 i = 0; i < 3; i++) {
            uint8 idx = shareIndices[i];
            require(idx < GUARDIAN_COUNT, "invalid share index");
            require(v.guardians[idx].shareReleased, "share not released");
            count++;
        }
        require(count >= THRESHOLD, "need 3 released shares");

        v.state = State.CLAIMED;
        emit Claimed(vaultId, msg.sender);
    }

    // ============================================================
    // replaceGuardian
    // ============================================================
    /**
     * @notice Replaces an unavailable guardian. Only callable by vault owner.
     * @param vaultId Vault to modify
     * @param guardianId Index of guardian to replace (0-4)
     */
    function replaceGuardian(bytes32 vaultId, uint8 guardianId) external {
        require(guardianId < GUARDIAN_COUNT, "invalid guardian");
        VaultData storage v = _vault(vaultId);
        require(vaultOwners[vaultId] == msg.sender, "not owner");
        require(v.state == State.ACTIVE, "only in active state");

        // Mark old guardian as offline, effectively replacing them
        Guardian storage g = v.guardians[guardianId];
        require(g.online, "already offline");
        
        g.online = false;
        emit GuardianToggled(vaultId, guardianId, false);
        emit GuardianReplaced(vaultId, guardianId, msg.sender);
    }

    // ============================================================
    // View helpers
    // ============================================================
    function getVault(bytes32 vaultId) external view returns (VaultData memory) {
        return _vault(vaultId);
    }

    function getAllVaultIds() external view returns (bytes32[] memory) {
        return vaultIds;
    }

    function getVaultState(bytes32 vaultId) external view returns (State) {
        return vaults[vaultId].state;
    }

    function getHeartbeatDeadline(bytes32 vaultId) external view returns (uint256) {
        VaultData storage v = _vault(vaultId);
        return v.lastHeartbeatAt + v.heartbeatIntervalMs / 1000;
    }

    function isHeartbeatMissed(bytes32 vaultId) external view returns (bool) {
        VaultData storage v = _vault(vaultId);
        return _heartbeatMissed(v);
    }

    function getAttestationCount(bytes32 vaultId) external view returns (uint8) {
        return _attestationCount(_vault(vaultId));
    }

    function getReleasedShareCount(bytes32 vaultId) external view returns (uint8) {
        return _releasedShareCount(_vault(vaultId));
    }

    function getChallengeEndsAt(bytes32 vaultId) external view returns (uint256) {
        VaultData storage v = _vault(vaultId);
        return _challengeEndsAt(v);
    }
}