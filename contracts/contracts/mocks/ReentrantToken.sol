// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST DOUBLE: an ERC-20 that, once armed, calls back into a target contract in the middle of its next transfer
///         (what an ERC-777-style hook or a malicious token could do). Records whether the reentrant call got through.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;
    bool public reentrySucceeded;
    bytes4 public reentryError;
    uint256 public reentries;

    constructor() ERC20("Reentrant Token", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0)) {
            armed = false;
            reentries++;
            (bool ok, bytes memory ret) = target.call(payload);
            reentrySucceeded = ok;
            if (!ok && ret.length >= 4) reentryError = bytes4(ret);
        }
    }
}
