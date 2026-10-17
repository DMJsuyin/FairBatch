// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
/// @notice Unrestricted faucet token for demonstrations only. NOT wrapped MON or real USDC.
contract DemoToken is ERC20 {
    uint8 private immutable precision;
    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) { precision = decimals_; }
    function decimals() public view override returns (uint8) { return precision; }
    function faucet() external { _mint(msg.sender, 10_000 * 10 ** precision); }
}
