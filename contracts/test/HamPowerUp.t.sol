// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamPowerUp} from "../src/HamPowerUp.sol";

contract HamPowerUpTest is Test {
    HamPowerUp nft;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        nft = new HamPowerUp();
    }

    function testMintIsFree() public {
        vm.prank(alice);
        uint256 id = nft.mint();
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), alice);
        assertEq(nft.balanceOf(alice), 1);
    }

    function testOnePerWallet() public {
        vm.startPrank(alice);
        nft.mint();
        vm.expectRevert(HamPowerUp.AlreadyMinted.selector);
        nft.mint();
        vm.stopPrank();
    }

    function testBoosterBalanceOfWorksLikeERC20() public {
        // This is the whole point: HamDailyRun.boostOf() calls balanceOf(player) on any
        // registered token. An NFT must answer that the same way an ERC-20 would.
        vm.prank(alice);
        nft.mint();
        assertEq(nft.balanceOf(alice), 1);
        assertEq(nft.balanceOf(bob), 0);
    }

    function testSupplyCap() public {
        for (uint256 i = 0; i < nft.MAX_SUPPLY(); i++) {
            vm.prank(address(uint160(i + 1000)));
            nft.mint();
        }
        assertEq(nft.totalSupply(), nft.MAX_SUPPLY());
        vm.prank(address(0xDEAD));
        vm.expectRevert(HamPowerUp.SoldOut.selector);
        nft.mint();
    }

    function testTransfer() public {
        vm.prank(alice);
        uint256 id = nft.mint();
        vm.prank(alice);
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
        assertEq(nft.balanceOf(alice), 0);
        assertEq(nft.balanceOf(bob), 1);
    }

    function testTransferFromNotOwnerOrApprovedReverts() public {
        vm.prank(alice);
        uint256 id = nft.mint();
        vm.prank(bob);
        vm.expectRevert(HamPowerUp.NotAuthorized.selector);
        nft.transferFrom(alice, bob, id);
    }

    function testApprovedCanTransfer() public {
        vm.prank(alice);
        uint256 id = nft.mint();
        vm.prank(alice);
        nft.approve(bob, id);
        vm.prank(bob);
        nft.transferFrom(alice, bob, id);
        assertEq(nft.ownerOf(id), bob);
    }

    function testTokenUriIsValidDataUri() public {
        vm.prank(alice);
        uint256 id = nft.mint();
        string memory uri = nft.tokenURI(id);
        assertTrue(bytes(uri).length > 0);
        // starts with the expected data URI prefix
        bytes memory prefix = bytes("data:application/json;base64,");
        bytes memory u = bytes(uri);
        for (uint256 i = 0; i < prefix.length; i++) assertEq(u[i], prefix[i]);
    }

    function testNonexistentTokenReverts() public {
        vm.expectRevert(HamPowerUp.NoSuchToken.selector);
        nft.ownerOf(999);
    }

    function testSupportsInterface() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(nft.supportsInterface(0x01ffc9a7)); // ERC165
        assertFalse(nft.supportsInterface(0xdeadbeef));
    }
}
