// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IAnonAadhaar} from "@anon-aadhaar/contracts/interfaces/IAnonAadhaar.sol";

/// @notice TEST DOUBLE for the Anon Aadhaar verifier. Never deploy it on a public network.
/// @dev A "proof" is valid exactly when it commits to the full set of public inputs (seed, nullifier, timestamp, the
///      hashed signal, reveal flags), as a real Groth16 proof does: change any input, such as a signal bound to a
///      different sender or claim, and verification fails. The signal hash is computed the way the real contract does.
contract MockAnonAadhaar is IAnonAadhaar {
    function signalHashOf(uint256 signal) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(signal))) >> 3;
    }

    function commitment(uint256 seed, uint256 nullifier, uint256 timestamp, uint256 signal, uint256[4] memory reveal) public pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, nullifier, timestamp, signalHashOf(signal), reveal)));
    }

    /// @notice What a prover would hand over for these inputs.
    function proofFor(uint256 seed, uint256 nullifier, uint256 timestamp, uint256 signal, uint256[4] memory reveal) external pure returns (uint256[8] memory p) {
        p[0] = commitment(seed, nullifier, timestamp, signal, reveal);
    }

    function verifyAnonAadhaarProof(
        uint256 nullifierSeed,
        uint256 nullifier,
        uint256 timestamp,
        uint256 signal,
        uint256[4] memory revealArray,
        uint256[8] memory groth16Proof
    ) external pure returns (bool) {
        return groth16Proof[0] != 0 && groth16Proof[0] == commitment(nullifierSeed, nullifier, timestamp, signal, revealArray);
    }
}
