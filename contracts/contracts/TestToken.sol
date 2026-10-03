// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Heirloom Test Token (HTT)
/// @notice A worthless ERC-20 with a public faucet, deployed on test networks so crypto assets can be tried without real tokens.
///         Never deploy this on a network where tokens have value.
contract TestToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucet;

    error FaucetCooldown(uint256 availableAt);

    constructor() ERC20("Heirloom Test Token", "HTT") {}

    /// @notice Mints 1,000 HTT to the caller, at most once an hour.
    function faucet() external {
        uint256 last = lastFaucet[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) revert FaucetCooldown(last + FAUCET_COOLDOWN);
        lastFaucet[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
