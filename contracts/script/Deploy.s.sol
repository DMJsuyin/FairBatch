// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SealBatch} from "../src/SealBatch.sol";

/// WINDOW_BLOCKS / TIMEOUT_WINDOWS / BOND / FEE_BPS 可用环境变量覆盖
contract Deploy is Script {
    function run() external returns (SealBatch sb) {
        uint256 w = vm.envOr("WINDOW_BLOCKS", uint256(12));
        uint256 t = vm.envOr("TIMEOUT_WINDOWS", uint256(10));
        uint256 bond = vm.envOr("BOND", uint256(1e18));
        uint256 fee = vm.envOr("FEE_BPS", uint256(5));
        vm.startBroadcast();
        sb = new SealBatch(w, t, bond, fee);
        vm.stopBroadcast();
        console.log("SealBatch", address(sb));
        console.log("BASE", address(sb.base()));
        console.log("QUOTE", address(sb.quote()));
        console.log("genesisBlock", sb.genesisBlock());
    }
}
