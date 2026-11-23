// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamPoints} from "../src/HamPoints.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";

/// A stand-in for a redeem contract (a $PFWA swap, a partner's claim, a v4 hook): pulls a player's
/// approved points in, then burns them.
contract MockRedeemer {
    HamPoints immutable points;

    constructor(HamPoints p) {
        points = p;
    }

    function redeem(uint256 amount) external {
        points.transferFrom(msg.sender, address(this), amount);
        points.burn(amount);
    }
}

contract RevertingPoints {
    function mint(address, uint256) external pure {
        revert("nope");
    }
}

contract HamPointsTest is Test {
    HamPoints points;
    address owner = makeAddr("owner");
    address game = makeAddr("game");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address gateway = makeAddr("gateway");

    function setUp() public {
        points = new HamPoints(owner);
        vm.startPrank(owner);
        points.setMinter(game, true);
        points.setGateway(gateway, true);
        vm.stopPrank();
        vm.prank(game);
        points.mint(alice, 100e18);
    }

    function test_isAPlainErc20ToRead() public view {
        assertEq(points.name(), "HAM Points");
        assertEq(points.symbol(), "HAMP");
        assertEq(points.decimals(), 18);
        assertEq(points.totalSupply(), 100e18);
        assertEq(points.balanceOf(alice), 100e18);
    }

    function test_onlyMintersMint() public {
        vm.expectRevert(HamPoints.NotMinter.selector);
        vm.prank(alice);
        points.mint(alice, 1);
        vm.expectRevert(HamPoints.NotMinter.selector);
        vm.prank(owner); // the owner isn't a minter either
        points.mint(owner, 1);
    }

    function test_walletToWalletTransferReverts() public {
        vm.expectRevert(HamPoints.NotTransferable.selector);
        vm.prank(alice);
        points.transfer(bob, 1e18);
    }

    function test_approvedSpenderStillCantMoveToAWallet() public {
        // approval alone doesn't make points tradeable: a DEX router or marketplace can't route them to a buyer
        vm.prank(alice);
        points.approve(bob, type(uint256).max);
        vm.expectRevert(HamPoints.NotTransferable.selector);
        vm.prank(bob);
        points.transferFrom(alice, bob, 1e18);
    }

    function test_playerCanSendToAGateway() public {
        vm.prank(alice);
        points.transfer(gateway, 40e18);
        assertEq(points.balanceOf(gateway), 40e18);
        assertEq(points.balanceOf(alice), 60e18);
    }

    function test_gatewayCanSendOn() public {
        vm.prank(alice);
        points.transfer(gateway, 40e18);
        vm.prank(gateway);
        points.transfer(bob, 10e18);
        assertEq(points.balanceOf(bob), 10e18);
    }

    function test_gatewayNeedsApprovalToPull() public {
        vm.expectRevert(HamPoints.InsufficientAllowance.selector);
        vm.prank(gateway);
        points.transferFrom(alice, gateway, 1e18);
    }

    function test_redeemFlowPullsAndBurns() public {
        MockRedeemer r = new MockRedeemer(points);
        vm.prank(owner);
        points.setGateway(address(r), true);
        vm.startPrank(alice);
        points.approve(address(r), 30e18);
        r.redeem(30e18);
        vm.stopPrank();
        assertEq(points.balanceOf(alice), 70e18);
        assertEq(points.totalSupply(), 70e18, "redeemed points are burned");
        assertEq(points.allowance(alice, address(r)), 0);
    }

    function test_removedGatewayStopsReceiving() public {
        vm.prank(owner);
        points.setGateway(gateway, false);
        vm.expectRevert(HamPoints.NotTransferable.selector);
        vm.prank(alice);
        points.transfer(gateway, 1e18);
    }

    function test_holderBurnsOwnPoints() public {
        vm.prank(alice);
        points.burn(25e18);
        assertEq(points.balanceOf(alice), 75e18);
        assertEq(points.totalSupply(), 75e18);
        vm.expectRevert(HamPoints.InsufficientBalance.selector);
        vm.prank(bob);
        points.burn(1);
    }

    function test_lockMintersIsForever() public {
        vm.startPrank(owner);
        points.lockMinters();
        vm.expectRevert(HamPoints.Locked.selector);
        points.setMinter(owner, true);
        vm.expectRevert(HamPoints.Locked.selector);
        points.setMinter(game, false);
        vm.stopPrank();
        vm.prank(game);
        points.mint(bob, 1); // the locked-in game still mints
        assertEq(points.balanceOf(bob), 1);
    }

    function test_onlyOwnerAdmins() public {
        vm.startPrank(alice);
        vm.expectRevert(HamPoints.NotOwner.selector);
        points.setMinter(alice, true);
        vm.expectRevert(HamPoints.NotOwner.selector);
        points.setGateway(alice, true);
        vm.expectRevert(HamPoints.NotOwner.selector);
        points.lockMinters();
        vm.stopPrank();
    }

    function test_ownershipIsTwoStep() public {
        vm.prank(owner);
        points.transferOwnership(bob);
        assertEq(points.owner(), owner, "unchanged until accepted");
        vm.expectRevert(HamPoints.NotPendingOwner.selector);
        vm.prank(alice);
        points.acceptOwnership();
        vm.prank(bob);
        points.acceptOwnership();
        assertEq(points.owner(), bob);
    }

    function test_noMintOrSendToZero() public {
        vm.expectRevert(HamPoints.ZeroAddress.selector);
        vm.prank(game);
        points.mint(address(0), 1);
        vm.expectRevert(HamPoints.ZeroAddress.selector);
        vm.prank(gateway);
        points.transfer(address(0), 0);
    }

    function testFuzz_onlyGatewaySidedTransfersMove(address from, address to, uint96 amount) public {
        vm.assume(from != address(0) && to != address(0) && from != gateway && to != gateway);
        vm.prank(game);
        points.mint(from, amount);
        vm.expectRevert(HamPoints.NotTransferable.selector);
        vm.prank(from);
        points.transfer(to, amount);
    }
}

/// HAM Points earned through the game contract.
contract HamRobinhoodPointsTest is Test {
    HamRobinhood run;
    HamPoints points;
    uint256 refereeKey = 0xA11CE;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    uint256 constant FEE = 0.01 ether;
    uint256 day;

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        run = new HamRobinhood(
            owner, vm.addr(refereeKey), makeAddr("treasury"), FEE,
            HamRobinhood.GameConfig({mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0})
        );
        day = run.currentDay();
        vm.deal(alice, 10 ether);
        points = new HamPoints(owner);
        vm.startPrank(owner);
        points.setMinter(address(run), true);
        run.setHamPoints(address(points));
        vm.stopPrank();
    }

    function play(address p, uint32 pointsSigned) internal returns (uint256 tokenId) {
        uint32 attempt = run.attempts(day, p);
        bytes32 h = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", run.runDigest(day, p, attempt, pointsSigned, 90_000, 2, true))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, h);
        vm.prank(p);
        tokenId = run.playRun{value: FEE}(
            HamRobinhood.RunResult({points: pointsSigned, timeMs: 90_000, kills: 2, completed: true}), abi.encodePacked(r, s, v), address(0)
        );
    }

    function ranked(uint256 tokenId) internal view returns (uint256 p) {
        (,,, uint32 pts,,,) = run.scores(tokenId);
        p = pts;
    }

    function test_aRunMintsItsRankedPoints() public {
        play(alice, 5000);
        assertEq(points.balanceOf(alice), 5000e18);
    }

    function test_repeatRunMintsItsReducedPoints() public {
        uint256 a = play(alice, 5000);
        uint256 b = play(alice, 5000); // the second run today keeps 92%
        assertEq(ranked(b), 4600);
        assertEq(points.balanceOf(alice), (ranked(a) + ranked(b)) * 1e18);
        assertEq(points.balanceOf(alice), 9600e18);
    }

    function test_noPointsContractMeansNoMint() public {
        vm.prank(owner);
        run.setHamPoints(address(0));
        play(alice, 5000);
        assertEq(points.balanceOf(alice), 0);
    }

    function test_revertingPointsContractNeverBlocksARun() public {
        RevertingPoints bad = new RevertingPoints();
        vm.prank(owner);
        run.setHamPoints(address(bad));
        uint256 tokenId = play(alice, 5000);
        assertEq(run.ownerOf(tokenId), alice);
    }

    function test_gameWithoutMinterRoleStillPlays() public {
        vm.prank(owner);
        points.setMinter(address(run), false);
        uint256 tokenId = play(alice, 5000);
        assertEq(run.ownerOf(tokenId), alice);
        assertEq(points.balanceOf(alice), 0);
    }

    function test_onlyOwnerSetsHamPoints() public {
        vm.expectRevert(HamRobinhood.NotOwner.selector);
        vm.prank(alice);
        run.setHamPoints(alice);
    }
}
