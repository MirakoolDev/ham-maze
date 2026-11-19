// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamScoreArt} from "../src/HamScoreArt.sol";

/// @notice The on-chain Score must be byte-for-byte the drawing design/nft/ham-art.js makes.
/// Fixtures come from `node design/nft/build-contract-art.mjs`.
contract HamScoreArtTest is Test {
    HamScoreArt art;

    function setUp() public {
        art = new HamScoreArt();
    }

    function test_matchesTheJsDrawing() public view {
        string[] memory lines = vm.split(vm.readFile("./test/fixtures/cases.txt"), "\n");
        uint256 checked;
        for (uint256 i; i < lines.length; ++i) {
            if (bytes(lines[i]).length == 0) continue;
            string[] memory f = vm.split(lines[i], " ");
            string memory got = art.renderSeed(
                vm.parseUint(f[0]),
                vm.parseUint(f[1]),
                uint32(vm.parseUint(f[2])),
                uint32(vm.parseUint(f[3])),
                uint32(vm.parseUint(f[4])),
                vm.parseUint(f[5]) == 1,
                vm.parseUint(f[6]) == 1
            );
            string memory want = vm.readFile(string.concat("./test/fixtures/score-", vm.toString(i), ".svg"));
            assertEq(got, want, string.concat("score case ", vm.toString(i)));
            ++checked;
        }
        assertEq(checked, 40);
    }

    function test_dayNumberMapsToTheGameSeed() public view {
        // 2026-11-18 is day 20775 since 1970-01-01
        string memory byDay = art.render(1, 20775, 1234, 60000, 2, true, false);
        string memory bySeed = art.renderSeed(1, 20261118, 1234, 60000, 2, true, false);
        assertEq(byDay, bySeed);
    }

    function test_sealedDrawsFewerWalls() public view {
        string memory sealedSvg = art.renderSeed(1, 20261119, 8000, 112000, 4, true, true);
        string memory openSvg = art.renderSeed(1, 20261119, 8000, 112000, 4, true, false);
        assertLt(bytes(sealedSvg).length, bytes(openSvg).length);
    }

    function test_gasForAFullDrawingFitsAnRpcCall() public view {
        uint256 g = gasleft();
        art.renderSeed(1, 20240806, 8000, 112000, 4, true, false);
        uint256 used = g - gasleft();
        assertLt(used, 30_000_000, "eth_call gas caps are often 30M to 50M");
    }
}
