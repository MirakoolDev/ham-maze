// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";
import {HamPoints} from "../src/HamPoints.sol";

/// Regression tests for the IMD audit of commit 87bf9e2
/// (https://explorer.imd.fun/jobs/f8e38de0-f6d7-4102-b734-7aa7be4339e7). Each test is named after
/// the finding it closes, and fails on the audited code.

contract PassNFT {
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => address) public ownerOf;
    uint256 next;

    function mint(address to) external returns (uint256 id) {
        id = ++next;
        balanceOf[to] += 1;
        ownerOf[id] = to;
    }

    function move(address to, uint256 id) external {
        balanceOf[ownerOf[id]] -= 1;
        balanceOf[to] += 1;
        ownerOf[id] = to;
    }
}

contract NoEth {} // rejects plain ETH

contract HamRobinhoodAuditTest is Test {
    HamRobinhood game;
    uint256 refereeKey = 0xA11CE;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address mallory = makeAddr("mallory");
    uint256 constant FEE = 0.01 ether;

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        game = new HamRobinhood(
            owner, vm.addr(refereeKey), treasury, FEE,
            HamRobinhood.GameConfig({mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0})
        );
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(mallory, 10 ether);
        vm.deal(address(this), 100 ether);
    }

    function result(address p, uint32 attempt, uint32 points, uint16 boost)
        internal
        view
        returns (HamRobinhood.RunResult memory r, bytes memory sig)
    {
        uint256 day = game.currentDay();
        r = HamRobinhood.RunResult({points: points, timeMs: 90_000, kills: 2, completed: true, attempt: attempt, boostBps: boost});
        bytes32 h = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", game.runDigest(day, p, attempt, points, 90_000, 2, true, boost))
        );
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(refereeKey, h);
        sig = abi.encodePacked(rr, s, v);
    }

    function play(address p, uint32 points) internal returns (uint256) {
        return play(p, points, address(0));
    }

    function play(address p, uint32 points, address referrer) internal returns (uint256) {
        (HamRobinhood.RunResult memory r, bytes memory sig) = result(p, game.attempts(game.currentDay(), p), points, 0);
        vm.prank(p);
        return game.playRun{value: FEE}(r, sig, referrer);
    }

    function settleToday() internal returns (uint256 day) {
        day = game.currentDay();
        vm.warp((day + 1) * 1 days + 16 minutes);
        game.settle(day);
    }

    function _unclaimed(uint256 day) internal view returns (uint256 u) {
        (, u,,,,,) = game.dayInfo(day);
    }

    function _pot(uint256 day) internal view returns (uint256 p) {
        (p,,,,,,) = game.dayInfo(day);
    }

    // ── 1 (high): sweep names any day ──────────────────────────────────────────
    function test_1_freshPrizeCannotBeSweptByNamingAnOldDay() public {
        uint256 dayA = game.currentDay();
        game.fundPot{value: 10 ether}(dayA);
        uint256 aliceToken = play(alice, 5000);
        settleToday();
        uint256 alicePrize = game.prizeOf(aliceToken);

        vm.warp((dayA + 9) * 1 days + 1 hours);
        uint256 bobToken = play(bob, 5000);
        settleToday();
        uint256 bobPrize = game.prizeOf(bobToken);

        vm.prank(mallory);
        vm.expectRevert(HamRobinhood.NotRanked.selector);
        game.sweep(dayA, bobToken);

        assertEq(game.prizeOf(bobToken), bobPrize);
        assertEq(_unclaimed(dayA), alicePrize);
        vm.prank(bob);
        game.claimIntent(bobToken);
        vm.warp(block.timestamp + game.CLAIM_DELAY());
        vm.prank(bob);
        game.claimFinalize(bobToken, bob);
    }

    // ── 2 (medium): one holder NFT, many free runs ─────────────────────────────
    function test_2_onePassGivesOneFreeRunPerDayWhoeverHoldsIt() public {
        PassNFT pass = new PassNFT();
        vm.prank(owner);
        game.setHolderToken(address(pass));
        uint256 id = pass.mint(alice);

        (HamRobinhood.RunResult memory r, bytes memory sig) = result(alice, 0, 5000, 0);
        vm.prank(alice);
        game.playFreeRun(r, sig, address(0), id);

        pass.move(bob, id);
        (r, sig) = result(bob, 0, 5000, 0);
        vm.prank(bob);
        vm.expectRevert(HamRobinhood.WrongFee.selector);
        game.playFreeRun(r, sig, address(0), id);

        // someone else's pass doesn't work either
        uint256 other = pass.mint(mallory);
        vm.prank(bob);
        vm.expectRevert(HamRobinhood.NotHolder.selector);
        game.playFreeRun(r, sig, address(0), other);
    }

    function test_2_boostIsWhatTheRefereeSigned() public {
        // the contract no longer reads balances at play time: a borrowed token can't boost a run
        (HamRobinhood.RunResult memory r, bytes memory sig) = result(alice, 0, 5000, 0);
        r.boostBps = 5000; // claim a boost the referee didn't sign
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.BadSignature.selector);
        game.playRun{value: FEE}(r, sig, address(0));

        (r, sig) = result(alice, 0, 5000, 1000);
        vm.prank(alice);
        uint256 id = game.playRun{value: FEE}(r, sig, address(0));
        (,,, uint32 ranked,,,,) = game.scores(id);
        assertEq(ranked, 5500);
    }

    // ── 3 (medium): unsubmitted retries kept their points ──────────────────────
    function test_3_theSignedAttemptSetsTheCut() public {
        // the referee signed runs 0..3 for alice; she submits only the 4th (attempt 3)
        (HamRobinhood.RunResult memory r, bytes memory sig) = result(alice, 3, 9000, 0);
        vm.prank(alice);
        uint256 id = game.playRun{value: FEE}(r, sig, address(0));
        (,,, uint32 ranked,,,,) = game.scores(id);
        assertEq(ranked, 9000 * 7600 / 10_000, "cut as her 4th run");
        assertEq(game.attempts(game.currentDay(), alice), 4);

        // an earlier signature can't be used afterwards
        (r, sig) = result(alice, 0, 9000, 0);
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.BadAttempt.selector);
        game.playRun{value: FEE}(r, sig, address(0));
    }

    // ── 4 (low): holder bonus judged at settle ─────────────────────────────────
    function test_4_holderBonusFollowsHoldingAtPlayTime() public {
        PassNFT pass = new PassNFT();
        vm.prank(owner);
        game.setHolderToken(address(pass));
        uint256 id = play(alice, 5000); // not a holder when she played
        pass.mint(alice); // ...but is one by settle
        settleToday();
        assertEq(game.prizeOf(id), FEE * 4000 / 10_000, "no holder bonus");
    }

    // ── 5 (low): dust made a paid run revert ───────────────────────────────────
    function test_5_holderCanStillPayForARun() public {
        PassNFT pass = new PassNFT();
        vm.prank(owner);
        game.setHolderToken(address(pass));
        pass.mint(alice);
        play(alice, 5000); // a paid run, though she holds a pass with an unused free run
        assertEq(_pot(game.currentDay()), FEE);
    }

    // ── 6 (low): a paid Score stayed frozen forever ────────────────────────────
    function test_6_paidScoreCanMoveAgain() public {
        uint256 id = play(alice, 5000);
        settleToday();
        vm.prank(alice);
        game.claimIntent(id);
        assertTrue(game.isFrozen(id));
        vm.warp(block.timestamp + game.CLAIM_DELAY());
        vm.prank(alice);
        game.claimFinalize(id, alice);
        assertFalse(game.isFrozen(id));
        vm.prank(alice);
        game.transferFrom(alice, bob, id);
        assertEq(game.ownerOf(id), bob);
    }

    // ── 7 (low): a stale prize could be revived ────────────────────────────────
    function test_7_noClaimIntentAfterTheWindow() public {
        uint256 id = play(alice, 5000);
        uint256 day = settleToday();
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.ClaimClosed.selector);
        game.claimIntent(id);
        game.sweep(day, id); // still sweepable
    }

    // ── 8 (low): one refusing recipient blocked both payouts ───────────────────
    function test_8_treasuryIsPaidWhenBackersRefuse() public {
        NoEth bad = new NoEth();
        vm.prank(owner);
        game.setBackers(address(bad));
        play(alice, 5000);
        settleToday();
        uint256 owedBackers = game.backersOwed();
        game.withdrawTreasury();
        assertEq(treasury.balance, FEE / 10, "treasury paid");
        assertEq(game.treasuryOwed(), 0);
        assertEq(game.backersOwed(), owedBackers, "backers' share stays owed");
    }

    // ── 9 (low): empty days lost 20% of the pot ────────────────────────────────
    function test_9_emptyDaysRollTheWholePot() public {
        uint256 day = game.currentDay();
        game.fundPot{value: 10 ether}(day);
        for (uint256 i; i < 7; ++i) {
            vm.warp((day + i + 1) * 1 days + 16 minutes);
            game.settle(day + i);
        }
        assertEq(_pot(day + 7), 10 ether);
        assertEq(game.treasuryOwed() + game.backersOwed(), 0);
    }

    // ── 10 (low): an address with no code blocked every run ────────────────────
    function test_10_hookAddressesMustHaveCode() public {
        vm.startPrank(owner);
        vm.expectRevert(HamRobinhood.NoCode.selector);
        game.setHamPoints(address(0xdEaD));
        vm.expectRevert(HamRobinhood.NoCode.selector);
        game.setPowerUp(address(0xdEaD));
        vm.expectRevert(HamRobinhood.NoCode.selector);
        game.setHolderToken(address(0xdEaD));
        HamRobinhood.Booster[] memory b = new HamRobinhood.Booster[](1);
        b[0] = HamRobinhood.Booster({token: address(0xdEaD), minBalance: 1, bps: 1000});
        vm.expectRevert(HamRobinhood.BadBooster.selector);
        game.setBoosters(b);
        game.setHamPoints(address(0)); // zero still turns a hook off
        vm.stopPrank();
    }

    // ── 11 (low): self-referral to a fresh wallet ──────────────────────────────
    function test_11_referrerMustHavePlayed() public {
        address alt = makeAddr("alt");
        play(alice, 5000, alt);
        assertEq(game.referrerOf(alice), address(0), "a wallet that never played can't be a referrer");

        play(bob, 4000, alice); // alice has played, so she can refer
        assertEq(game.referrerOf(bob), alice);
    }

    // ── 12 (low): the backers' end could be restarted ──────────────────────────
    function test_12_backersEndIsFinalOncePassed() public {
        uint256 day = game.currentDay();
        vm.prank(owner);
        game.setBackersEnd(day + 1);
        vm.warp((day + 3) * 1 days);
        vm.prank(owner);
        vm.expectRevert(HamRobinhood.BadBackersEnd.selector);
        game.setBackersEnd(day + 10);
    }

    function test_12_backersEndCanStillMoveLaterBeforeItPasses() public {
        uint256 day = game.currentDay();
        vm.startPrank(owner);
        game.setBackersEnd(day + 5);
        game.setBackersEnd(day + 9);
        vm.stopPrank();
        assertEq(game.backersEndDay(), day + 9);
    }

    // ── 13 (info): a 0-point repeat run could take a place ─────────────────────
    function test_13_zeroRankedRunReverts() public {
        play(alice, 5000);
        (HamRobinhood.RunResult memory r, bytes memory sig) = result(alice, 1, 1, 0); // 1 * 92% rounds to 0
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.BadTime.selector);
        game.playRun{value: FEE}(r, sig, address(0));
    }

    // ── 14 (info): trust limits on minting points ──────────────────────────────
    function test_14_pointsPerRunAreCapped() public {
        (HamRobinhood.RunResult memory r, bytes memory sig) = result(alice, 0, game.MAX_RUN_POINTS() + 1, 0);
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.BadTime.selector);
        game.playRun{value: FEE}(r, sig, address(0));
    }

    function test_14_newRefereeWaitsTheDelay() public {
        address next = makeAddr("next");
        vm.startPrank(owner);
        game.setReferee(next);
        assertEq(game.referee(), vm.addr(refereeKey), "old key still signs");
        vm.expectRevert(HamRobinhood.TooEarly.selector);
        game.acceptReferee();
        vm.warp(block.timestamp + game.REFEREE_DELAY());
        game.acceptReferee();
        vm.stopPrank();
        assertEq(game.referee(), next);
    }

    function test_14_gatewaysCanBeLocked() public {
        HamPoints points = new HamPoints(owner);
        vm.startPrank(owner);
        points.setGateway(address(this), true);
        points.lockGateways();
        vm.expectRevert(HamPoints.Locked.selector);
        points.setGateway(mallory, true);
        vm.expectRevert(HamPoints.Locked.selector);
        points.setGateway(address(this), false);
        vm.stopPrank();
    }
}
