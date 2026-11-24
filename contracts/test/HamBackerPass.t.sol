// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamBackerPass, IPassArt} from "../src/HamBackerPass.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";

contract HamBackerPassTest is Test {
    HamBackerPass pass;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    function setUp() public {
        pass = new HamBackerPass(owner);
    }

    function _drop(address a, uint256 id) internal {
        address[] memory to = new address[](1);
        uint256[] memory ids = new uint256[](1);
        to[0] = a;
        ids[0] = id;
        vm.prank(owner);
        pass.airdrop(to, ids);
    }

    function test_airdropKeepsTheEthereumNumbers() public {
        address[] memory to = new address[](3);
        uint256[] memory ids = new uint256[](3);
        (to[0], to[1], to[2]) = (alice, bob, alice);
        (ids[0], ids[1], ids[2]) = (3, 1, 7);
        vm.prank(owner);
        pass.airdrop(to, ids);
        assertEq(pass.totalSupply(), 3);
        assertEq(pass.ownerOf(3), alice);
        assertEq(pass.ownerOf(1), bob);
        assertEq(pass.balanceOf(alice), 2);
        assertEq(pass.tokenOfOwnerByIndex(alice, 0), 3);
        assertEq(pass.tokenOfOwnerByIndex(alice, 1), 7);
        assertEq(pass.tokenByIndex(1), 1);
    }

    function test_onlyOwnerAirdropsAndEachNumberOnce() public {
        address[] memory to = new address[](1);
        uint256[] memory ids = new uint256[](1);
        (to[0], ids[0]) = (alice, 1);
        vm.prank(alice);
        vm.expectRevert(HamBackerPass.NotOwner.selector);
        pass.airdrop(to, ids);
        _drop(alice, 1);
        vm.prank(owner);
        vm.expectRevert(HamBackerPass.AlreadyMinted.selector);
        pass.airdrop(to, ids);
    }

    function test_lockMintIsPermanent() public {
        _drop(alice, 1);
        vm.prank(owner);
        pass.lockMint();
        address[] memory to = new address[](1);
        uint256[] memory ids = new uint256[](1);
        (to[0], ids[0]) = (bob, 2);
        vm.prank(owner);
        vm.expectRevert(HamBackerPass.Locked.selector);
        pass.airdrop(to, ids);
    }

    function test_itCanBeSoldAndTheListsFollow() public {
        _drop(alice, 1);
        _drop(alice, 2);
        _drop(alice, 3);
        vm.prank(alice);
        pass.setApprovalForAll(carol, true); // a marketplace
        vm.prank(carol);
        pass.transferFrom(alice, bob, 1);
        assertEq(pass.ownerOf(1), bob);
        assertEq(pass.balanceOf(alice), 2);
        assertEq(pass.balanceOf(bob), 1);
        assertEq(pass.tokenOfOwnerByIndex(bob, 0), 1);
        // alice's last pass moved into the freed slot
        assertEq(pass.tokenOfOwnerByIndex(alice, 0), 3);
        assertEq(pass.tokenOfOwnerByIndex(alice, 1), 2);
        vm.expectRevert(HamBackerPass.NoSuchToken.selector);
        pass.tokenOfOwnerByIndex(alice, 2);
    }

    function test_strangersCantMoveIt() public {
        _drop(alice, 1);
        vm.prank(bob);
        vm.expectRevert(HamBackerPass.NotAuthorized.selector);
        pass.transferFrom(alice, bob, 1);
    }

    function test_tokenURIUntilArtIsSet() public {
        _drop(alice, 5);
        string memory uri = pass.tokenURI(5);
        assertEq(bytes(uri).length > 40, true);
        vm.expectRevert(HamBackerPass.NoSuchToken.selector);
        pass.tokenURI(6);
        vm.startPrank(owner);
        pass.lockArt();
        vm.expectRevert(HamBackerPass.Locked.selector);
        pass.setArt(IPassArt(address(1)));
        vm.stopPrank();
    }

    function test_supportsEnumerable() public view {
        assertTrue(pass.supportsInterface(0x780e9d63));
        assertTrue(pass.supportsInterface(0x80ac58cd));
    }

    // The point of it: as HamRobinhood's holder NFT, the free run goes with the pass when it's sold.
    function test_freeRunFollowsThePassInTheGame() public {
        uint256 refereeKey = 0xA11CE;
        vm.warp(20_000 days + 3 hours);
        HamRobinhood game = new HamRobinhood(
            owner, vm.addr(refereeKey), makeAddr("treasury"), 0.01 ether,
            HamRobinhood.GameConfig({mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0})
        );
        vm.prank(owner);
        game.setHolderToken(address(pass));
        _drop(alice, 3);
        assertTrue(game.isHolder(alice));

        vm.prank(alice);
        pass.transferFrom(alice, bob, 3);
        assertFalse(game.isHolder(alice));
        assertTrue(game.isHolder(bob));

        uint256 day = game.currentDay();
        HamRobinhood.RunResult memory r = HamRobinhood.RunResult({points: 5000, timeMs: 90_000, kills: 2, completed: true, attempt: 0, boostBps: 0});
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", game.runDigest(day, bob, 0, 5000, 90_000, 2, true, 0)));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(refereeKey, h);
        vm.prank(bob);
        game.playFreeRun(r, abi.encodePacked(rr, s, v), address(0), 3);
        assertTrue(game.freeRunUsed(day, 3));
    }
}
