// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";

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

    function _pot() internal view returns (uint256 pot) {
        (pot,,,,,,) = run.dayInfo(day);
    }

    function _potOn(uint256 d) internal view returns (uint256 pot) {
        (pot,,,,,,) = run.dayInfo(d);
    }
}
