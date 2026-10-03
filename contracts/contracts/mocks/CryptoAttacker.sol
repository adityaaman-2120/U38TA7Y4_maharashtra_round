// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Heirloom} from "../Heirloom.sol";

/// @notice TEST DOUBLE: a smart-contract wallet that acts as an owner or a beneficiary and, when it receives native currency,
///         tries to re-enter Heirloom. It records whether the reentrant call succeeded and which error it hit.
contract CryptoAttacker {
    Heirloom public immutable h;
    uint256 public targetAsset;
    bool public reenterWithdraw; // beneficiary role: call withdraw() again from receive()
    bool public reenterOwnerWithdraw; // owner role: call ownerWithdraw() again from receive()
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public received;

    constructor(Heirloom h_) {
        h = h_;
    }

    // ---- setup helpers (the attacker is the msg.sender Heirloom sees)
    function registerKey(bytes calldata key) external {
        h.registerEncryptionKey(key);
    }

    function createVault(address[] calldata guardians, uint8 threshold, uint64 interval) external {
        h.createVault(guardians, threshold, interval, false);
    }

    function addNative(address beneficiary, Heirloom.Policy calldata policy) external payable returns (uint256 id) {
        id = h.addCryptoAsset{value: msg.value}(beneficiary, address(0), msg.value, policy);
        targetAsset = id;
    }

    function raise(uint256 assetId, Heirloom.EvidenceType t, bytes32 evidenceHash, string calldata sid, Heirloom.ZkProof calldata proof) external {
        h.raiseClaim(assetId, t, evidenceHash, sid, proof);
    }

    // ---- actions that pay the attacker
    function setReenter(bool onWithdraw, bool onOwnerWithdraw, uint256 assetId) external {
        reenterWithdraw = onWithdraw;
        reenterOwnerWithdraw = onOwnerWithdraw;
        targetAsset = assetId;
    }

    function pull(uint256 assetId) external {
        h.withdraw(assetId);
    }

    function pullOwner(uint256 assetId, uint256 amount) external {
        h.ownerWithdraw(assetId, amount);
    }

    receive() external payable {
        received += msg.value;
        if (reenterWithdraw) {
            reenterWithdraw = false;
            try h.withdraw(targetAsset) {
                reentrySucceeded = true;
            } catch (bytes memory err) {
                if (err.length >= 4) reentryError = bytes4(err);
            }
        }
        if (reenterOwnerWithdraw) {
            reenterOwnerWithdraw = false;
            try h.ownerWithdraw(targetAsset, 1) {
                reentrySucceeded = true;
            } catch (bytes memory err) {
                if (err.length >= 4) reentryError = bytes4(err);
            }
        }
    }
}
