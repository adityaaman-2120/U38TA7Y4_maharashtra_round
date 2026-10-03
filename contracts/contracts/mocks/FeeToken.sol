// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST DOUBLE: a fee-on-transfer token. Every transfer between two real accounts burns 1% of the amount, so a
///         receiver gets less than was sent. Used to prove Heirloom credits what actually arrives.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0), fee); // burn the fee
            value -= fee;
        }
        super._update(from, to, value);
    }
}
