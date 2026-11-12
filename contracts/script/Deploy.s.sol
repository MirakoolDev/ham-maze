// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HamDailyRun} from "../src/HamDailyRun.sol";

/// forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --account <keystore>
/// Env: HAM_OWNER, HAM_REFEREE, HAM_TREASURY, HAM_ENTRY_FEE (wei, default 0.001 ether)
contract Deploy is Script {
    function run() external returns (HamDailyRun deployed) {
        address owner = vm.envAddress("HAM_OWNER");
        address referee = vm.envAddress("HAM_REFEREE");
        address treasury = vm.envAddress("HAM_TREASURY");
        uint256 fee = vm.envOr("HAM_ENTRY_FEE", uint256(0.001 ether));
        HamDailyRun.GameConfig memory cfg = HamDailyRun.GameConfig({
            mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 13, playerHealth: 100, magSize: 30, loops: 0
        });
        vm.startBroadcast();
        deployed = new HamDailyRun(owner, referee, treasury, fee, cfg);
        vm.stopBroadcast();
        console2.log("HamDailyRun", address(deployed));
    }
}
