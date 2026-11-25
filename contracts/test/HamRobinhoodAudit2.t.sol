// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";
import {PassNFT, NoEth} from "./HamRobinhoodAudit.t.sol";

/// Settles another day from inside the treasury payout (audit 2, finding 5).
contract ReenteringTreasury {
    HamRobinhood public game;
    uint256 public day;

    function aim(HamRobinhood g, uint256 d) external {
        game = g;
        day = d;
    }

    receive() external payable {
        if (address(game) != address(0) && day != 0) {
            uint256 d = day;
            day = 0;
            game.settle(d);
        }
    }
}

/// Regression tests for the second IMD audit (commit f102368,
/// https://explorer.imd.fun/jobs/d63373cb-544e-45c0-a25a-c3f0a153733a). HamPowerUps' findings are in
/// HamPowerUpsDeal.t.sol.
contract HamRobinhoodAudit2Test is Test {
    HamRobinhood game;
    ReenteringTreasury treasury;
    PassNFT pass;
    uint256 refereeKey = 0xA11CE;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 constant FEE = 0.01 ether;

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        treasury = new ReenteringTreasury();
        game = new HamRobinhood(
            owner, vm.addr(refereeKey), address(treasury), FEE,
            HamRobinhood.GameConfig({mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0})
        );
        pass = new PassNFT();
        vm.prank(owner);
        game.setHolderToken(address(pass));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
    }

    function _result(address p, uint32 points) internal view returns (HamRobinhood.RunResult memory r, bytes memory sig) {
        uint256 day = game.currentDay();
        uint32 attempt = game.attempts(day, p);
        r = HamRobinhood.RunResult({points: points, timeMs: 90_000, kills: 2, completed: true, attempt: attempt, boostBps: 0});
        bytes32 h = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", game.runDigest(day, p, attempt, points, 90_000, 2, true, 0))
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(refereeKey, h);
        sig = abi.encodePacked(rr, s, v);
    }

    function _paid(address p, uint32 points) internal returns (uint256) {
        (HamRobinhood.RunResult memory r, bytes memory sig) = _result(p, points);
        vm.prank(p);
        return game.playRun{value: FEE}(r, sig, address(0));
    }

    function _free(address p, uint32 points, uint256 passId) internal returns (uint256) {
        (HamRobinhood.RunResult memory r, bytes memory sig) = _result(p, points);
        vm.prank(p);
        return game.playFreeRun(r, sig, address(0), passId);
    }

    function _holderFlag(uint256 id) internal view returns (bool h) {
        (,,,,,,, h) = game.scores(id);
    }

    function _settleToday() internal returns (uint256 day) {
        day = game.currentDay();
        vm.warp((day + 1) * 1 days + 16 minutes);
        game.settle(day);
    }

    // ── 3 (medium): one pass flagged many wallets' runs for the holder bonus ─────
    function test_3_onePassFlagsOneRunADay() public {
        uint256 passId = pass.mint(alice);
        uint256 a = _free(alice, 5000, passId); // the pass's free run: flagged
        pass.move(bob, passId);
        uint256 b = _paid(bob, 6000); // holds the pass now, but its run for today is spent
        pass.move(carol, passId);
        uint256 c = _paid(carol, 5500);
        assertTrue(_holderFlag(a));
        assertFalse(_holderFlag(b));
        assertFalse(_holderFlag(c));
        // and a paid run by a holder is never flagged either: the bonus rides on the pass's one run
        assertFalse(_holderFlag(_paid(carol, 100)));

        _settleToday();
        uint256 pot = 3 * FEE; // the free run adds nothing
        assertEq(game.prizeOf(b), pot * 4000 / 10_000, "first place, no holder bonus");
        assertEq(game.prizeOf(c), pot * 2000 / 10_000, "second, no holder bonus");
        assertEq(game.prizeOf(a), pot * 1000 / 10_000 * 11_000 / 10_000, "third, with the bonus");
    }

    // ── 5 (low): a share settled while the treasury was being paid was wiped ─────
    function test_5_reenteredSettleKeepsItsTreasuryShare() public {
        _paid(alice, 5000);
        uint256 day1 = _settleToday();
        uint256 owed1 = game.treasuryOwed();
        assertGt(owed1, 0);
        uint256 day2 = game.currentDay();
        _paid(bob, 5000); // day 2's pot: its own fee plus day 1's rollover
        (uint256 pot2,,,,,,) = game.dayInfo(day2);
        vm.warp((day2 + 1) * 1 days + 16 minutes);
        treasury.aim(game, day2);
        uint256 backers1 = game.backersOwed(); // backers default to the treasury address
        game.withdrawTreasury(); // the treasury settles day 2 while receiving day 1's share
        assertEq(address(treasury).balance, owed1 + backers1);
        assertEq(game.treasuryOwed(), pot2 * owed1 / FEE, "day 2's share is still owed");
        assertTrue(day1 != day2);
    }

    // ── 8 + 9 (low): claimed prizes kept prizeOf and approvals; a holder that can't take ETH lost out ─
    function test_8_9_claimClearsStateAndPaysWhereTheHolderSays() public {
        NoEth vault = new NoEth();
        uint256 id = _paid(alice, 5000);
        vm.prank(alice);
        game.transferFrom(alice, address(vault), id);
        _settleToday();
        uint256 prize = game.prizeOf(id);
        assertGt(prize, 0);
        vm.startPrank(address(vault));
        game.approve(bob, id);
        game.claimIntent(id);
        vm.warp(block.timestamp + game.CLAIM_DELAY());
        vm.expectRevert(HamRobinhood.TransferFailed.selector);
        game.claimFinalize(id, address(vault)); // can't take ETH itself...
        game.claimFinalize(id, carol); // ...so it names another address
        vm.stopPrank();
        assertEq(carol.balance, 10 ether + prize);
        assertEq(game.prizeOf(id), 0);
        assertEq(game.getApproved(id), address(0));
    }
}
