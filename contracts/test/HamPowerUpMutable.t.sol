// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamPowerUpMutable} from "../src/HamPowerUpMutable.sol";

contract HamPowerUpMutableTest is Test {
    HamPowerUpMutable pu;
    address owner = makeAddr("owner");
    address game = makeAddr("game");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        pu = new HamPowerUpMutable(owner);
        vm.prank(owner);
        pu.setGame(game);
    }

    function test_mintIsFreeOncePerWallet() public {
        vm.prank(alice);
        uint256 tokenId = pu.mint();
        assertEq(pu.ownerOf(tokenId), alice);
        vm.prank(alice);
        vm.expectRevert(HamPowerUpMutable.AlreadyMinted.selector);
        pu.mint();
    }

    function test_onlyGameCanRecordRuns() public {
        vm.prank(alice);
        pu.mint();
        vm.expectRevert(HamPowerUpMutable.NotGame.selector);
        pu.recordRun(alice, 5, true);
    }

    function test_recordRunAccumulatesLifetimeStats() public {
        vm.prank(alice);
        pu.mint();
        vm.prank(game);
        pu.recordRun(alice, 3, true);
        vm.prank(game);
        pu.recordRun(alice, 4, false);
        (uint32 kills, uint32 mazes) = pu.stats(pu.tokenOf(alice));
        assertEq(kills, 7);
        assertEq(mazes, 1);
    }

    function test_recordRunForNonHolderIsANoop() public {
        vm.prank(game);
        pu.recordRun(alice, 10, true); // alice never minted, should not revert
    }

    function test_tierRisesWithMazesCompleted() public {
        vm.prank(alice);
        uint256 tokenId = pu.mint();
        for (uint256 i; i < pu.SILVER_AT(); ++i) {
            vm.prank(game);
            pu.recordRun(alice, 1, true);
        }
        (, uint32 mazes) = pu.stats(tokenId);
        assertEq(mazes, pu.SILVER_AT(), "crossed the silver threshold");
        // tokenURI must still render without reverting at the higher tier
        string memory uri = pu.tokenURI(tokenId);
        assertGt(bytes(uri).length, 0);
    }

    /// @notice The first token a wallet holds keeps leveling for it; one it receives later by
    /// trade does not silently take over as the tracked token.
    function test_tokenOfFollowsFirstTokenOnTransfer() public {
        vm.prank(alice);
        uint256 t1 = pu.mint();
        vm.prank(bob);
        uint256 t2 = pu.mint();

        vm.prank(bob);
        pu.transferFrom(bob, alice, t2);

        assertEq(pu.tokenOf(alice), t1, "alice's first token stays the tracked one");
        assertEq(pu.tokenOf(bob), 0, "bob has nothing left to track");
    }
}
