// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

// Pulls the official Anon Aadhaar verifier into the Hardhat build so deploy scripts can deploy it.
import {AnonAadhaar} from "@anon-aadhaar/contracts/src/AnonAadhaar.sol";
import {Verifier} from "@anon-aadhaar/contracts/src/Verifier.sol";
