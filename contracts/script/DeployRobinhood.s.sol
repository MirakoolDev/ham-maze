// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";
import {HamPoints} from "../src/HamPoints.sol";

/// Deploys the Robinhood Chain game and HAM Points, and wires them together:
/// HamPoints lets the game mint, the game mints points after each run, and the campaign backers'
/// 10% of each pot ends on BACKERS_END_DAY.
///
/// forge script script/DeployRobinhood.s.sol --rpc-url robinhood --broadcast --account <keystore>
/// Env: HAM_OWNER (must be the broadcasting account, so it can wire things up), HAM_REFEREE,
/// HAM_TREASURY, HAM_ENTRY_FEE (wei, default 0.0003 ether)
///
/// Afterwards, from the owner: setBackers(<the FundingWorks payout address>), then the art
/// (script/DeployArt.s.sol). Lock HamPoints' minters (lockMinters) once no other game will mint.
contract DeployRobinhood is Script {
    /// 2027-06-05 UTC, as a day number (unix time / 1 day). The FundingWorks mint closes on
    /// 2026-12-05; backers are paid from every pot for the six months after that. The first day
    /// whose pot no longer pays them is this one, so the last paid day is 2027-06-04.
    uint256 public constant BACKERS_END_DAY = 20_974;

    function run() external returns (HamRobinhood game, HamPoints points) {
        address owner = vm.envAddress("HAM_OWNER");
        address referee = vm.envAddress("HAM_REFEREE");
        address treasury = vm.envAddress("HAM_TREASURY");
        uint256 fee = vm.envOr("HAM_ENTRY_FEE", uint256(0.0003 ether));
        HamRobinhood.GameConfig memory cfg = HamRobinhood.GameConfig({
            mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 13, playerHealth: 100, magSize: 30, loops: 0
        });

        vm.startBroadcast();
        game = new HamRobinhood(owner, referee, treasury, fee, cfg);
        points = new HamPoints(owner);
        points.setMinter(address(game), true);
        game.setHamPoints(address(points));
        game.setBackersEnd(BACKERS_END_DAY);
        vm.stopBroadcast();

        console2.log("HamRobinhood", address(game));
        console2.log("HamPoints", address(points));
        console2.log("Backers paid through day", BACKERS_END_DAY - 1);
    }
}
