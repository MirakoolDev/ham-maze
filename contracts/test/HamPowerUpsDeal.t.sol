// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamPowerUps} from "../src/HamPowerUps.sol";

/// Regression tests for the second IMD audit: packs are dealt in sale order, so neither the order
/// packs are opened in nor the block they're opened in can steer a draw.
contract HamPowerUpsDealTest is Test {
    HamPowerUps pu;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        vm.warp(20_000 days);
        vm.roll(100);
        pu = new HamPowerUps(owner);
        vm.startPrank(owner);
        pu.addKind("Marker", "COMMON", 4000);
        pu.addKind("Freeze", "RARE", 2000);
        pu.addKind("Pulse", "RARE", 2000);
        pu.addKind("Blinker", "EPIC", 1000);
        pu.addKind("Snare", "EPIC", 1000);
        pu.lock();
        vm.stopPrank();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(carol, 100 ether);
    }

    function _buy(address who, uint256 count) internal returns (uint256 first) {
        (uint256 cost,) = pu.quote(count);
        vm.prank(who);
        first = pu.buy{value: cost}(count);
    }

    function _kinds(uint256 n) internal view returns (uint256[] memory k) {
        k = new uint256[](n);
        for (uint256 i; i < n; ++i) k[i] = pu.kindOf(i + 1);
    }

    /// Audit finding 1 (PackDrawOrder): opening in a chosen order used to change what each pack held.
    function test_openOrderCannotSteerADraw() public {
        _buy(alice, 10);
        vm.roll(block.number + 1);
        _buy(bob, 10);
        vm.roll(block.number + 1);
        _buy(carol, 10);
        vm.roll(block.number + 1);

        uint256 snap = vm.snapshotState();
        for (uint256 t = 1; t <= 30; ++t) {
            vm.prank(pu.ownerOf(t));
            pu.open(t);
        }
        uint256[] memory forward = _kinds(30);

        vm.revertToState(snap);
        // carol opens her last pack first: everyone's packs are dealt, in sale order, to the same guns
        vm.prank(carol);
        uint256 k = pu.open(30);
        assertEq(k, forward[29]);
        assertEq(pu.opened(), 30);
        assertEq(_kinds(30), forward);
        // and a holder who opened nothing finds their packs already dealt
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.AlreadyOpened.selector);
        pu.open(1);
        assertEq(pu.equippedKind(alice), forward[0], "first dealt gun is equipped");
    }

    function test_anyoneCanDealAndItChangesNothing() public {
        _buy(alice, 20);
        vm.roll(block.number + 1);
        uint256 snap = vm.snapshotState();
        for (uint256 t = 20; t >= 1; --t) {
            vm.prank(alice);
            try pu.open(t) {} catch {}
        }
        uint256[] memory a = _kinds(20);
        vm.revertToState(snap);
        vm.prank(bob);
        pu.deal(20);
        assertEq(_kinds(20), a);
    }

    function test_dealIsCappedPerCall() public {
        for (uint256 i; i < 5; ++i) _buy(alice, 20);
        vm.roll(block.number + 1);
        vm.prank(alice);
        assertEq(pu.open(100), 0, "64 earlier packs dealt, 100 still sealed");
        assertEq(pu.opened(), pu.MAX_DEAL());
        vm.prank(alice);
        assertTrue(pu.open(100) != 0);
        assertEq(pu.opened(), 100);
    }

    function test_packsBoughtThisBlockWaitForTheNext() public {
        _buy(alice, 1);
        vm.roll(block.number + 1);
        _buy(bob, 1); // same block as this deal
        pu.deal(2);
        assertEq(pu.opened(), 1);
        vm.roll(block.number + 1);
        pu.deal(2);
        assertEq(pu.opened(), 2);
    }

    /// Audit finding 2 (LateOpenReroll): a pack whose hash aged out used to draw from the block before
    /// the open, so the holder could retry block after block until it showed a good gun.
    function test_lostHashIsResealedNotRerolled() public {
        _buy(alice, 1);
        uint256 bought = block.number;
        vm.roll(bought + 1000); // nobody touched the contract: the hash is gone
        vm.prank(alice);
        assertEq(pu.open(1), 0, "re-sealed, not drawn");
        uint256 resealed = block.number;
        assertEq(pu.movedTo(bought), resealed);
        assertEq(pu.sealBlock(1), resealed);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.TooSoon.selector);
        pu.open(1);

        // the outcome now rests on the re-seal block's hash: opening at any later block gives the same gun
        vm.roll(resealed + 1);
        uint256 snap = vm.snapshotState();
        vm.prank(alice);
        uint256 first = pu.open(1);
        assertTrue(first != 0);
        vm.revertToState(snap);
        vm.roll(resealed + 200);
        vm.prank(alice);
        assertEq(pu.open(1), first);
    }

    function test_publicKeepSealSavesALateHash() public {
        _buy(alice, 1);
        uint256 bought = block.number;
        vm.roll(bought + 5);
        pu.keepSeal(); // the keeper's call
        assertTrue(pu.blockSeal(bought) == blockhash(bought));
        vm.roll(bought + 5000);
        vm.prank(alice);
        assertTrue(pu.open(1) != 0, "drawn from the kept hash, no re-seal");
        assertEq(pu.movedTo(bought), 0);
    }
}
