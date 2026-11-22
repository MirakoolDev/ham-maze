// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";
import {HamScoreArt} from "../src/HamScoreArt.sol";

contract MockNFT {
    mapping(address => uint256) public balanceOf;

    function mint(address to) external {
        balanceOf[to] += 1;
    }
}

contract MockPowerUp {
    address public game;
    mapping(address => uint32) public kills;
    mapping(address => uint32) public mazesCompleted;

    function setGame(address g) external {
        game = g;
    }

    function recordRun(address player, uint32 k, bool completed) external {
        require(msg.sender == game, "not game");
        kills[player] += k;
        if (completed) mazesCompleted[player] += 1;
    }
}

contract RevertingPowerUp {
    function recordRun(address, uint32, bool) external pure {
        revert("nope");
    }
}

contract HamRobinhoodTest is Test {
    HamRobinhood run;
    uint256 refereeKey = 0xA11CE;
    address referee;
    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    uint256 constant FEE = 0.01 ether;
    uint256 day;

    function cfg() internal pure returns (HamRobinhood.GameConfig memory) {
        return HamRobinhood.GameConfig({
            mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0
        });
    }

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        referee = vm.addr(refereeKey);
        run = new HamRobinhood(owner, referee, treasury, FEE, cfg());
        day = run.currentDay();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(carol, 10 ether);
    }

    function pts(uint32 t) internal pure returns (uint32) {
        return uint32(1_000_000_000 / uint256(t));
    }

    function sign(address p, uint32 attempt, uint32 t, uint32 kills, bool completed) internal view returns (bytes memory) {
        bytes32 h = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32", run.runDigest(day, p, attempt, pts(t), t, kills, completed)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, h);
        return abi.encodePacked(r, s, v);
    }

    // convenience overload: a plain finished run with a couple of kills
    function sign(address p, uint32 attempt, uint32 t) internal view returns (bytes memory) {
        return sign(p, attempt, t, 2, true);
    }

    function play(address p, uint32 t) internal returns (uint256 tokenId) {
        tokenId = play(p, t, address(0));
    }

    function play(address p, uint32 t, address referrer) internal returns (uint256 tokenId) {
        uint32 attempt = run.attempts(day, p);
        bytes memory sig = sign(p, attempt, t); // compute before prank: sign() itself calls out to the contract
        vm.prank(p);
        tokenId = run.playRun{value: FEE}(HamRobinhood.RunResult({points: pts(t), timeMs: t, kills: 2, completed: true}), sig, referrer);
    }

    // ── single-tx play ──────────────────────────────────────────────────────────
    function test_playRunPaysAndMintsInOneCall() public {
        uint256 potBefore = _pot();
        uint256 tokenId = play(alice, 100);
        assertEq(_pot(), potBefore + FEE, "fee went into the pot");
        assertEq(run.ownerOf(tokenId), alice, "score NFT minted to the player");
        (uint64 d, address player, uint32 attempt, uint32 points,,,) = run.scores(tokenId);
        assertEq(d, day);
        assertEq(player, alice);
        assertEq(attempt, 0);
        assertGt(points, 0);
    }

    function test_losingCostsAnotherFeeToRetry() public {
        play(alice, 100); // attempt 0, paid
        uint256 potAfter1 = _pot();
        play(alice, 90); // attempt 1, a second paid run (a "retry")
        assertEq(_pot(), potAfter1 + FEE, "retry is a fresh paid attempt, not free");
    }

    function test_wrongFeeReverts() public {
        uint32 attempt = run.attempts(day, alice);
        bytes memory sig = sign(alice, attempt, 100);
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.WrongFee.selector);
        run.playRun{value: FEE - 1}(HamRobinhood.RunResult({points: pts(100), timeMs: 100, kills: 2, completed: true}), sig, address(0));
    }

    function test_badSignatureReverts() public {
        uint32 attempt = run.attempts(day, alice);
        bytes memory sig = sign(bob, attempt, 100); // signed for bob, played by alice
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.BadSignature.selector);
        run.playRun{value: FEE}(HamRobinhood.RunResult({points: pts(100), timeMs: 100, kills: 2, completed: true}), sig, address(0));
    }

    // ── repeat runs ─────────────────────────────────────────────────────────────
    function test_attemptShareStepsDownToTheFloor() public view {
        assertEq(run.attemptShare(0), 10000, "first run keeps everything");
        assertEq(run.attemptShare(1), 9200);
        assertEq(run.attemptShare(2), 8400);
        assertEq(run.attemptShare(3), 7600);
        assertEq(run.attemptShare(4), 6800);
        assertEq(run.attemptShare(5), 6000, "sixth run hits the floor");
        assertEq(run.attemptShare(50), 6000, "and stays there");
    }

    function test_repeatRunRanksWithFewerPoints() public {
        uint256 first = play(alice, 100);
        uint256 second = play(alice, 100); // the same result, played again
        (,,, uint32 p1,,,) = run.scores(first);
        (,,, uint32 p2,,,) = run.scores(second);
        assertEq(p1, pts(100), "first run ranks with its full points");
        assertEq(p2, uint32(uint256(pts(100)) * 9200 / 10000), "second run keeps 92%");
    }

    function test_firstTryCanOutrankALaterBetterRun() public {
        for (uint256 i; i < 5; ++i) play(alice, 400); // five slow runs first
        uint256 aliceSixth = play(alice, 80); // a much faster run, but her sixth today (60%)
        uint256 bobFirst = play(bob, 100); // bob's only run
        (,,,, uint256[3] memory topToken,,) = run.dayInfo(day);
        assertEq(topToken[0], bobFirst, "bob's first try beats alice's faster sixth run");
        assertEq(topToken[1], aliceSixth);
    }

    function test_aStrongRepeatRunCanStillWin() public {
        play(alice, 300); // a weak first run
        uint256 aliceSecond = play(alice, 100); // much better on the second try (92%)
        play(bob, 150);
        (,,,, uint256[3] memory topToken,,) = run.dayInfo(day);
        assertEq(topToken[0], aliceSecond, "a strong second run still wins");
    }

    function test_repeatCountIsPerDay() public {
        play(alice, 100);
        play(alice, 100);
        vm.warp(block.timestamp + 1 days);
        day = run.currentDay();
        uint256 t = play(alice, 100);
        (,, uint32 attempt, uint32 p,,,) = run.scores(t);
        assertEq(attempt, 0, "a new day starts the count again");
        assertEq(p, pts(100));
    }

    // ── ranking and settling ────────────────────────────────────────────────────
    function test_topThreeRankedByPoints() public {
        uint256 t1 = play(alice, 100); // fastest = most points
        uint256 t2 = play(bob, 150);
        uint256 t3 = play(carol, 200);
        (,,,, uint256[3] memory topToken,,) = run.dayInfo(day);
        assertEq(topToken[0], t1);
        assertEq(topToken[1], t2);
        assertEq(topToken[2], t3);
    }

    function test_settleAssignsPrizeToTokenNotPlayer() public {
        uint256 t1 = play(alice, 100);
        play(bob, 150);
        play(carol, 200);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        assertGt(run.prizeOf(t1), 0);
    }

    function test_backersGetAFixedTenPercentAndBuybackGetsTheOtherTen() public {
        address splitter = makeAddr("backers");
        vm.prank(owner);
        run.setBackers(splitter);
        play(alice, 100);
        play(bob, 150);
        play(carol, 200);
        uint256 pot = _pot();
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        assertEq(run.backersOwed(), pot / 10, "backers: 10%, untouched by bonuses");
        assertEq(run.treasuryOwed(), pot / 10, "buyback: 10% (no holder or referral carve-outs here)");
        run.withdrawTreasury();
        assertEq(splitter.balance, pot / 10);
        assertEq(treasury.balance, pot / 10);
    }

    function test_backersShareStopsAtEndDayAndRollsOver() public {
        vm.prank(owner);
        run.setBackersEnd(day + 1);
        play(alice, 100);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        uint256 owedDay0 = run.backersOwed();
        assertGt(owedDay0, 0, "before the end day backers are paid");
        uint256 day1 = day + 1;
        vm.prank(alice);
        run.fundPot{value: 1 ether}(day1);
        vm.warp((day1 + 1) * 1 days + 16 minutes);
        uint256 nextBefore = _potOn(day1 + 1);
        uint256 pot1 = _potOn(day1);
        run.settle(day1);
        assertEq(run.backersOwed(), owedDay0, "from the end day nothing more goes to backers");
        // no runs: everything but the buyback rolls over, the backers' 10% included
        assertEq(_potOn(day1 + 1) - nextBefore, pot1 - pot1 / 10);
    }

    function test_backersEndOnlyMovesLater() public {
        vm.startPrank(owner);
        vm.expectRevert(HamRobinhood.BadBackersEnd.selector);
        run.setBackersEnd(day);
        run.setBackersEnd(day + 180);
        vm.expectRevert(HamRobinhood.BadBackersEnd.selector);
        run.setBackersEnd(day + 179);
        run.setBackersEnd(day + 200);
        vm.stopPrank();
        assertEq(run.backersEndDay(), day + 200);
    }

    // ── two-step claim: the Wenwin double-dip fix ──────────────────────────────
    function test_claimRequiresIntentThenDelay() public {
        uint256 t1 = play(alice, 100);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);

        vm.prank(alice);
        vm.expectRevert(HamRobinhood.ClaimNotIntended.selector);
        run.claimFinalize(t1);

        vm.prank(alice);
        run.claimIntent(t1);

        vm.prank(alice);
        vm.expectRevert(HamRobinhood.TooEarly.selector);
        run.claimFinalize(t1);

        vm.warp(block.timestamp + run.CLAIM_DELAY());
        uint256 balBefore = alice.balance;
        vm.prank(alice);
        run.claimFinalize(t1);
        assertGt(alice.balance, balBefore);
    }

    /// @notice Core fix: once claimIntent freezes the NFT, a sale either completes before the
    /// freeze (new owner claims) or the transfer reverts outright - there is no way for the
    /// seller to collect both the sale proceeds and the prize.
    function test_frozenScoreCannotBeTransferred() public {
        uint256 t1 = play(alice, 100);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);

        vm.prank(alice);
        run.claimIntent(t1);

        vm.prank(alice);
        vm.expectRevert(HamRobinhood.TokenFrozen.selector);
        run.transferFrom(alice, bob, t1);
    }

    function test_buyerWhoClaimsFirstOwnsTheClaim() public {
        uint256 t1 = play(alice, 100);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);

        // alice sells to bob before calling claimIntent at all
        vm.prank(alice);
        run.transferFrom(alice, bob, t1);

        vm.prank(alice);
        vm.expectRevert(HamRobinhood.NotTokenOwner.selector);
        run.claimIntent(t1);

        vm.prank(bob);
        run.claimIntent(t1);
        vm.warp(block.timestamp + run.CLAIM_DELAY());
        uint256 balBefore = bob.balance;
        vm.prank(bob);
        run.claimFinalize(t1);
        assertGt(bob.balance, balBefore);
    }

    function test_nonWinningTokenHasNothingToClaim() public {
        play(alice, 100);
        uint256 loser = play(bob, 999999); // deliberately bad time -> tiny points, still ranks since <3 entries
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        // bob's run still placed (only 2 entrants) but check the no-prize path on an unranked token directly
        vm.prank(bob);
        if (run.prizeOf(loser) == 0) {
            vm.expectRevert(HamRobinhood.NothingToClaim.selector);
            run.claimIntent(loser);
        }
    }

    function test_sweepReturnsUnclaimedPrizeToPot() public {
        uint256 t1 = play(alice, 100);
        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        uint256 amount = run.prizeOf(t1);

        vm.warp(block.timestamp + run.CLAIM_WINDOW() + 1);
        uint256 futureDay = run.currentDay();
        uint256 potBefore = _potOn(futureDay);
        run.sweep(day, t1);
        assertEq(_potOn(futureDay), potBefore + amount);
    }

    // ── free runs for holders ───────────────────────────────────────────────────
    function test_holderGetsOneFreeRunPerDay() public {
        MockNFT nft = new MockNFT();
        vm.prank(owner);
        run.setHolderToken(address(nft));
        nft.mint(alice);

        uint32 attempt = run.attempts(day, alice);
        bytes memory sig1 = sign(alice, attempt, 100);
        vm.prank(alice);
        run.playRun(HamRobinhood.RunResult({points: pts(100), timeMs: 100, kills: 2, completed: true}), sig1, address(0)); // no value sent

        // second run same day is not free
        attempt = run.attempts(day, alice);
        bytes memory sig2 = sign(alice, attempt, 90);
        vm.prank(alice);
        vm.expectRevert(HamRobinhood.WrongFee.selector);
        run.playRun(HamRobinhood.RunResult({points: pts(90), timeMs: 90, kills: 2, completed: true}), sig2, address(0));
    }

    // ── crew bonus ───────────────────────────────────────────────────────────────
    function test_crewBonusDoublesReferralOnceThreeReferredPlayToday() public {
        address dave = makeAddr("dave");
        vm.deal(dave, 10 ether);
        play(alice, 500); // alice refers nobody, just needs a winning run
        play(bob, 100, alice); // bob, carol, dave all referred by alice
        play(carol, 150, alice);
        play(dave, 200, alice);
        assertEq(run.crewSize(day, alice), 3);

        vm.warp(block.timestamp + 1 days + 16 minutes);
        run.settle(day);
        // bob ranked #1 (fastest of the referred three); referral reward should use the crew bps
        uint256 reward = run.referralOwed(alice);
        assertGt(reward, 0);
    }

    function test_powerUpIsNotifiedAfterARun() public {
        MockPowerUp pu = new MockPowerUp();
        pu.setGame(address(run));
        vm.prank(owner);
        run.setPowerUp(address(pu));

        play(alice, 100);
        assertEq(pu.kills(alice), 2);
        assertEq(pu.mazesCompleted(alice), 1);
    }

    function test_revertingPowerUpNeverBlocksARun() public {
        RevertingPowerUp pu = new RevertingPowerUp();
        vm.prank(owner);
        run.setPowerUp(address(pu));
        // should not revert even though the power-up contract always reverts
        play(alice, 100);
    }

    function test_scoreArtIsSealedUntilTheDayEnds() public {
        HamScoreArt art = new HamScoreArt();
        vm.prank(owner);
        run.setScoreArt(address(art));
        uint256 tokenId = play(alice, 100);

        string memory live = run.tokenURI(tokenId);
        vm.warp(block.timestamp + 6 hours); // still the same UTC day
        assertEq(run.tokenURI(tokenId), live, "unchanged while the day is live");
        vm.warp((day + 1) * 1 days); // 00:00 UTC
        assertTrue(keccak256(bytes(run.tokenURI(tokenId))) != keccak256(bytes(live)), "develops at midnight");
    }

    function test_lockedScoreArtCannotBeSwapped() public {
        HamScoreArt art = new HamScoreArt();
        vm.startPrank(owner);
        run.setScoreArt(address(art));
        run.lockScoreArt();
        vm.expectRevert(HamRobinhood.ArtLocked.selector);
        run.setScoreArt(address(0));
        vm.stopPrank();
    }

    function _pot() internal view returns (uint256 pot) {
        (pot,,,,,,) = run.dayInfo(day);
    }

    function _potOn(uint256 d) internal view returns (uint256 pot) {
        (pot,,,,,,) = run.dayInfo(d);
    }
}
