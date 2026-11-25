// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HamScoreArt} from "../src/HamScoreArt.sol";
import {HamPowerUps} from "../src/HamPowerUps.sol";

/// Deploys the Score renderer and the Power-Up packs, adds the lineup (caps add up to 10,000)
/// and uploads the pack art and each gun's art. It does not lock anything: check the art on a
/// marketplace first, then call HamPowerUps.lock() (which also opens pack sales) and
/// HamRobinhood.lockScoreArt() yourself. Pack pricing starts each day at 0.00055 ETH and goes x10
/// per 100 packs sold that day; change it with HamPowerUps.setPricing.
///
/// forge script script/DeployArt.s.sol --rpc-url robinhood --broadcast --account <keystore>
/// Env: HAM_OWNER (must be the broadcasting account, so it can add kinds), HAM_GAME (HamRobinhood)
contract DeployArt is Script {
    function run() external returns (HamScoreArt art, HamPowerUps pu) {
        address owner = vm.envAddress("HAM_OWNER");
        address game = vm.envAddress("HAM_GAME");
        string[5] memory keys = ["marker", "frost", "pulse", "blinker", "snare"];
        string[5] memory names = ["Marker", "Freeze", "Pulse", "Blinker", "Snare"];
        string[5] memory rarity = ["COMMON", "RARE", "RARE", "EPIC", "EPIC"];
        uint32[5] memory caps = [uint32(4000), 2000, 2000, 1000, 1000];

        vm.startBroadcast();
        art = new HamScoreArt();
        pu = new HamPowerUps(owner);
        pu.setGame(game, true);
        pu.setArt(0, bytes(vm.readFile("./art/pack.head.svg")), bytes(vm.readFile("./art/pack.tail.svg")));
        for (uint256 i; i < 5; ++i) {
            uint256 kind = pu.addKind(names[i], rarity[i], caps[i]);
            pu.setArt(
                kind,
                bytes(vm.readFile(string.concat("./art/", keys[i], ".head.svg"))),
                bytes(vm.readFile(string.concat("./art/", keys[i], ".tail.svg")))
            );
        }
        vm.stopBroadcast();
        console2.log("HamScoreArt", address(art));
        console2.log("HamPowerUps", address(pu));
        console2.log("Next: HamRobinhood.setScoreArt(art) and setPowerUp(pu) from its owner");
    }
}
