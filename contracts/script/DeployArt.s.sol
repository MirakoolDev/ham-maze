// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {HamScoreArt} from "../src/HamScoreArt.sol";
import {HamPowerUps} from "../src/HamPowerUps.sol";

/// Deploys the Score renderer and the Power-Up NFT, adds the lineup and uploads its art.
/// It does not lock anything: check the art on a marketplace first, then call
/// HamPowerUps.lock() and HamRobinhood.lockScoreArt() yourself.
///
/// forge script script/DeployArt.s.sol --rpc-url robinhood --broadcast --account <keystore>
/// Env: HAM_OWNER (must be the broadcasting account, so it can add kinds), HAM_GAME (HamRobinhood)
contract DeployArt is Script {
    function run() external returns (HamScoreArt art, HamPowerUps pu) {
        address owner = vm.envAddress("HAM_OWNER");
        address game = vm.envAddress("HAM_GAME");
        string[5] memory keys = ["marker", "frost", "pulse", "blinker", "snare"];
        string[5] memory names = ["Marker", "Frost dart", "Pulse", "Blinker", "Snare"];
        string[5] memory rarity = ["COMMON", "RARE", "RARE", "EPIC", "EPIC"];
        uint32[5] memory caps = [uint32(200), 100, 100, 50, 50];

        vm.startBroadcast();
        art = new HamScoreArt();
        pu = new HamPowerUps(owner);
        pu.setGame(game);
        for (uint256 i; i < 5; ++i) {
            // prices start at 0 (one free per wallet per kind); set real prices with setPrice
            uint256 kind = pu.addKind(names[i], rarity[i], caps[i], 0);
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
