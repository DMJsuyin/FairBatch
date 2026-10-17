// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "@openzeppelin/contracts-shanghai/utils/cryptography/ECDSA.sol";
contract SignatureWallet {
    address public immutable owner;
    constructor(address o) { owner = o; }
    function isValidSignature(bytes32 hash, bytes calldata sig) external view returns (bytes4) {
        return ECDSA.recover(hash,sig) == owner ? bytes4(0x1626ba7e) : bytes4(0xffffffff);
    }
    function execute(address target, bytes calldata data) external {
        require(msg.sender == owner);
        (bool ok,) = target.call(data); require(ok);
    }
}
