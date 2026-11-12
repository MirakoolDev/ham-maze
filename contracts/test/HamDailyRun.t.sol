// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamDailyRun} from "../src/HamDailyRun.sol";

contract MockNFT {
    mapping(address => uint256) public balanceOf;

    function mint(address to) external {
        balanceOf[to] += 1;
    }
}

contract Rejecter {
    function enter(HamDailyRun run) external payable {
        run.enter{value: msg.value}(address(0));
    }
}

contract HamDailyRunTest is Test {
    HamDailyRun run;
    MockNFT nft;
    uint256 refereeKey = 0xA11CE;
    address referee;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    uint256 constant FEE = 0.01 ether;
    uint256 day;

    function cfg() internal pure returns (HamDailyRun.GameConfig memory) {
        return HamDailyRun.GameConfig({
            mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0
        });
    }

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        referee = vm.addr(refereeKey);
        run = new HamDailyRun(owner, referee, treasury, FEE, cfg());
        nft = new MockNFT();
        day = run.currentDay();
        for (uint256 i; i < 4; ++i) vm.deal([alice, bob, carol, dave][i], 10 ether);
    }

    // ── helpers ──
    function sign(uint256 d, address p, uint32 attempt, uint32 t) internal view returns (bytes memory) {
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", run.runDigest(d, p, attempt, t)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, h);
        return abi.encodePacked(r, s, v);
    }

    function play(address p, uint32 t) internal returns (uint32 attempt) {
        vm.startPrank(p);
        attempt = run.enter{value: FEE}(address(0));
        run.submitRun(day, attempt, t, sign(day, p, attempt, t));
        vm.stopPrank();
    }

    function top() internal view returns (address[3] memory t, uint32[3] memory times) {
        (,,,, t, times) = run.dayInfo(day);
    }

    function pot(uint256 d) internal view returns (uint256 p) {
        (p,,,,,) = run.dayInfo(d);
    }

    function settleDay() internal {
        vm.warp((day + 1) * 1 days + 15 minutes);
        run.settle(day);
    }

    // ── entering ──
    function test_EnterAddsFeeToPot() public {
        vm.prank(alice);
        uint32 a = run.enter{value: FEE}(address(0));
        assertEq(a, 0);
        assertEq(pot(day), FEE);
        assertEq(run.attempts(day, alice), 1);
    }

    function test_EnterWrongFeeReverts() public {
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.WrongFee.selector);
        run.enter{value: FEE - 1}(address(0));
    }

    function test_PausedBlocksEntryOnly() public {
        uint32 a;
        vm.prank(alice);
        a = run.enter{value: FEE}(address(0));
        vm.prank(owner);
        run.setPaused(true);
        vm.prank(bob);
        vm.expectRevert(HamDailyRun.Paused.selector);
        run.enter{value: FEE}(address(0));
        bytes memory sig = sign(day, alice, a, 60_000);
        vm.prank(alice);
        run.submitRun(day, a, 60_000, sig); // still works
    }

    function test_FreeRunForHolderOncePerDay() public {
        vm.prank(owner);
        run.setHolderToken(address(nft));
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.NotHolder.selector);
        run.enterFree(address(0));
        nft.mint(alice);
        vm.startPrank(alice);
        run.enterFree(address(0));
        vm.expectRevert(HamDailyRun.FreeRunUsed.selector);
        run.enterFree(address(0));
        vm.stopPrank();
        assertEq(pot(day), 0);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        run.enterFree(address(0)); // a new day, a new free run
    }

    // ── runs ──
    function test_RankingKeepsTopThreeSorted() public {
        play(alice, 90_000);
        play(bob, 70_000);
        play(carol, 80_000);
        play(dave, 95_000); // too slow for the podium
        (address[3] memory t, uint32[3] memory times) = top();
        assertEq(t[0], bob);
        assertEq(t[1], carol);
        assertEq(t[2], alice);
        assertEq(times[0], 70_000);
        play(alice, 60_000); // alice improves to first
        (t,) = top();
        assertEq(t[0], alice);
        assertEq(t[1], bob);
        assertEq(t[2], carol);
        play(alice, 65_000); // a slower run does not move her
        (t, times) = top();
        assertEq(times[0], 60_000);
        assertEq(run.bestTime(day, alice), 60_000);
    }

    function test_TieKeepsEarlierRunAhead() public {
        play(alice, 70_000);
        play(bob, 70_000);
        (address[3] memory t,) = top();
        assertEq(t[0], alice);
        assertEq(t[1], bob);
    }

    function test_ForgedSignatureRejected() public {
        vm.startPrank(alice);
        uint32 a = run.enter{value: FEE}(address(0));
        bytes memory sig = sign(day, alice, a, 60_000);
        vm.expectRevert(HamDailyRun.BadSignature.selector);
        run.submitRun(day, a, 50_000, sig); // a faster time than was signed
        vm.stopPrank();
        vm.prank(bob); // someone else's signature
        vm.expectRevert(HamDailyRun.BadAttempt.selector);
        run.submitRun(day, a, 60_000, sig);
        vm.prank(bob);
        run.enter{value: FEE}(address(0));
        vm.prank(bob);
        vm.expectRevert(HamDailyRun.BadSignature.selector);
        run.submitRun(day, a, 60_000, sig);
    }

    function test_AttemptCannotBeReusedOrSkipped() public {
        vm.startPrank(alice);
        uint32 a = run.enter{value: FEE}(address(0));
        bytes memory sig = sign(day, alice, a, 60_000);
        bytes memory next = sign(day, alice, a + 1, 50_000);
        run.submitRun(day, a, 60_000, sig);
        vm.expectRevert(HamDailyRun.AttemptUsed.selector);
        run.submitRun(day, a, 60_000, sig);
        vm.expectRevert(HamDailyRun.BadAttempt.selector);
        run.submitRun(day, a + 1, 50_000, next);
        vm.stopPrank();
    }

    function test_LateSubmissionWindow() public {
        vm.prank(alice);
        uint32 a = run.enter{value: FEE}(address(0));
        bytes memory sig = sign(day, alice, a, 60_000);
        vm.warp((day + 1) * 1 days + 10 minutes); // inside the grace period
        vm.prank(alice);
        run.submitRun(day, a, 60_000, sig);

        vm.prank(bob);
        uint32 b = run.enter{value: FEE}(address(0)); // this lands on the new day
        assertEq(run.attempts(day + 1, bob), 1);
        vm.warp((day + 1) * 1 days + 15 minutes);
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.DayClosed.selector);
        run.submitRun(day, a, 60_000, sig);
        b;
    }

    // ── settling ──
    function test_SettleSplitsPot() public {
        play(alice, 60_000);
        play(bob, 70_000);
        play(carol, 80_000);
        play(dave, 90_000);
        uint256 p = pot(day); // 4 entries
        settleDay();
        assertEq(run.prizeOf(day, alice), p * 5000 / 10_000);
        assertEq(run.prizeOf(day, bob), p * 2000 / 10_000);
        assertEq(run.prizeOf(day, carol), p * 1000 / 10_000);
        assertEq(run.prizeOf(day, dave), 0);
        assertEq(run.treasuryOwed(), p * 1000 / 10_000);
        assertEq(pot(day + 1), p - p * 9000 / 10_000);
        vm.expectRevert(HamDailyRun.AlreadySettled.selector);
        run.settle(day);
    }

    function test_SettleTooEarlyReverts() public {
        play(alice, 60_000);
        vm.warp((day + 1) * 1 days + 14 minutes);
        vm.expectRevert(HamDailyRun.TooEarly.selector);
        run.settle(day);
    }

    function test_UnawardedPlacesRollOver() public {
        play(alice, 60_000);
        uint256 p = pot(day);
        settleDay();
        assertEq(run.prizeOf(day, alice), p / 2);
        assertEq(pot(day + 1), p - p / 2 - p / 10);
    }

    function test_HolderBonusAndReferralComeFromTreasury() public {
        vm.prank(owner);
        run.setHolderToken(address(nft));
        nft.mint(alice);
        vm.startPrank(alice);
        uint32 a = run.enter{value: FEE}(dave); // dave referred alice
        run.submitRun(day, a, 60_000, sign(day, alice, a, 60_000));
        vm.stopPrank();
        for (uint256 i; i < 9; ++i) play(bob, uint32(70_000 + i)); // grow the pot
        uint256 p = pot(day);
        settleDay();
        uint256 first = p / 2;
        uint256 bonus = first / 10;
        uint256 prize = first + bonus;
        uint256 reward = prize * 500 / 10_000;
        assertEq(run.referrerOf(alice), dave);
        assertEq(run.prizeOf(day, alice), prize);
        assertEq(run.referralOwed(dave), reward);
        assertEq(run.treasuryOwed(), p / 10 - bonus - reward);
    }

    function test_ReferrerRules() public {
        vm.prank(alice);
        run.enter{value: FEE}(alice); // self: ignored
        assertEq(run.referrerOf(alice), address(0));
        vm.prank(bob);
        run.enter{value: FEE}(alice);
        assertEq(run.referrerOf(bob), alice);
        vm.prank(carol);
        run.enter{value: FEE}(address(0));
        vm.prank(carol);
        run.enter{value: FEE}(bob); // not her first entry: ignored
        assertEq(run.referrerOf(carol), address(0));
        // mutual: dave refers... bob already refers to alice; alice can't be referred by bob now (alice joined)
        address eve = makeAddr("eve");
        vm.deal(eve, 1 ether);
        vm.prank(eve);
        run.enter{value: FEE}(dave);
        vm.prank(dave);
        run.enter{value: FEE}(eve); // eve was referred by dave, so dave can't be referred by eve
        assertEq(run.referrerOf(dave), address(0));
    }

    // ── claims ──
    function test_ClaimPaysOnceWithinWindow() public {
        play(alice, 60_000);
        uint256 p = pot(day);
        settleDay();
        uint256 before = alice.balance;
        vm.prank(alice);
        run.claim(day);
        assertEq(alice.balance - before, p / 2);
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.NothingToClaim.selector);
        run.claim(day);
    }

    function test_SweepAfterWindow() public {
        play(alice, 60_000);
        uint256 p = pot(day);
        settleDay();
        vm.expectRevert(HamDailyRun.ClaimOpen.selector);
        run.sweep(day);
        vm.warp(block.timestamp + 7 days + 1);
        uint256 today = run.currentDay();
        uint256 potBefore = pot(today);
        run.sweep(day);
        assertEq(pot(today) - potBefore, p / 2);
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.ClaimClosed.selector);
        run.claim(day);
    }

    function test_TreasuryAndReferralWithdraw() public {
        vm.prank(alice);
        uint32 a = run.enter{value: FEE}(dave);
        bytes memory sig = sign(day, alice, a, 60_000);
        vm.prank(alice);
        run.submitRun(day, a, 60_000, sig);
        settleDay();
        uint256 owed = run.treasuryOwed();
        run.withdrawTreasury();
        assertEq(treasury.balance, owed);
        uint256 r = run.referralOwed(dave);
        uint256 before = dave.balance;
        vm.prank(dave);
        run.claimReferral();
        assertEq(dave.balance - before, r);
    }

    // ── config ──
    function test_ConfigChangeWaitsForNextDay() public {
        HamDailyRun.GameConfig memory big = cfg();
        big.mazeSize = 20;
        big.cellSize = 9;
        play(alice, 60_000);
        vm.prank(owner);
        vm.expectRevert(HamDailyRun.DayStarted.selector);
        run.setConfig(big, true); // someone already ran today's maze
        vm.prank(owner);
        run.setConfig(big, false);
        assertEq(run.configFor(day).mazeSize, 12);
        assertEq(run.configFor(day + 1).mazeSize, 20);
        vm.warp(block.timestamp + 1 days);
        assertEq(run.currentConfig().mazeSize, 20);
        // a second change rolls the first into place and schedules the new one
        HamDailyRun.GameConfig memory huge = cfg();
        huge.mazeSize = 24;
        vm.prank(owner);
        run.setConfig(huge, false);
        assertEq(run.currentConfig().mazeSize, 20);
        assertEq(run.configFor(run.currentDay() + 1).mazeSize, 24);
    }

    function test_ImmediateConfigBeforeAnyEntry() public {
        HamDailyRun.GameConfig memory big = cfg();
        big.mazeSize = 16;
        vm.prank(owner);
        run.setConfig(big, true);
        assertEq(run.currentConfig().mazeSize, 16);
    }

    function test_ConfigBoundsAndOwnerOnly() public {
        HamDailyRun.GameConfig memory bad = cfg();
        bad.mazeSize = 40;
        vm.prank(owner);
        vm.expectRevert(HamDailyRun.BadConfig.selector);
        run.setConfig(bad, false);
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.NotOwner.selector);
        run.setConfig(cfg(), false);
        vm.prank(alice);
        vm.expectRevert(HamDailyRun.NotOwner.selector);
        run.setEntryFee(0);
    }

    function test_TwoStepOwnership() public {
        vm.prank(owner);
        run.transferOwnership(alice);
        assertEq(run.owner(), owner);
        vm.prank(bob);
        vm.expectRevert(HamDailyRun.NotPendingOwner.selector);
        run.acceptOwnership();
        vm.prank(alice);
        run.acceptOwnership();
        assertEq(run.owner(), alice);
    }

    // ── accounting: the contract always holds exactly what it owes ──
    function testFuzz_Solvency(uint8 players, uint32 seed) public {
        players = uint8(bound(players, 1, 12));
        vm.prank(owner);
        run.setHolderToken(address(nft));
        for (uint256 i; i < players; ++i) {
            address p = address(uint160(0x1000 + i));
            vm.deal(p, 1 ether);
            if (uint256(keccak256(abi.encode(seed, i))) % 3 == 0) nft.mint(p);
            address ref = i > 0 ? address(uint160(0x1000 + i - 1)) : address(0);
            vm.startPrank(p);
            uint32 a = run.enter{value: FEE}(ref);
            uint32 t = uint32(30_000 + uint256(keccak256(abi.encode(seed, i, "t"))) % 100_000);
            run.submitRun(day, a, t, sign(day, p, a, t));
            vm.stopPrank();
        }
        settleDay();
        uint256 owed = run.treasuryOwed() + pot(run.currentDay());
        (,, uint256 unclaimed,,,) = _info(day);
        owed += unclaimed;
        for (uint256 i; i < players; ++i) owed += run.referralOwed(address(uint160(0x1000 + i)));
        assertEq(address(run).balance, owed);
    }

    function _info(uint256 d) internal view returns (uint256, uint256, uint256, uint256, address[3] memory, uint32[3] memory) {
        (uint256 p, uint256 u, uint256 s, uint256 e, address[3] memory t, uint32[3] memory tt) = run.dayInfo(d);
        return (p, s, u, e, t, tt);
    }
}
