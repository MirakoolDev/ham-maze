// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamRobinhood} from "../src/HamRobinhood.sol";

/// Records HAM Points mints so the tests can see the streak bonus.
contract PointsSpy {
    mapping(address => uint256) public minted;
    uint256 public last;

    function mint(address to, uint256 amount) external {
        minted[to] += amount;
        last = amount;
    }
}

contract HamRobinhoodStreakTest is Test {
    HamRobinhood run;
    PointsSpy spy;
    uint256 refereeKey = 0xA11CE;
    address owner = makeAddr("owner");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant FEE = 0.01 ether;

    function setUp() public {
        vm.warp(20_000 days + 3 hours);
        run = new HamRobinhood(
            owner, vm.addr(refereeKey), makeAddr("treasury"), FEE,
            HamRobinhood.GameConfig({mazeSize: 12, cellSize: 7, sentries: 8, sentryHealth: 60, sentryDamage: 20, playerHealth: 100, magSize: 30, loops: 0})
        );
        spy = new PointsSpy();
        vm.prank(owner);
        run.setHamPoints(address(spy));
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _play(address p, bool completed) internal returns (uint256 minted) {
        uint256 day = run.currentDay();
        uint32 attempt = run.attempts(day, p);
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", run.runDigest(day, p, attempt, 5000, 90_000, 2, completed, 0)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, h);
        vm.prank(p);
        run.playRun{value: FEE}(
            HamRobinhood.RunResult({points: 5000, timeMs: 90_000, kills: 2, completed: completed, attempt: attempt, boostBps: 0}),
            abi.encodePacked(r, s, v), address(0)
        );
        minted = spy.last();
    }

    function _nextDay() internal {
        vm.warp(block.timestamp + 1 days);
    }

    function test_bonusGrowsTenPercentADayUpToFifty() public {
        uint256 base = 5000e18;
        assertEq(_play(alice, true), base); // day 1: no bonus
        uint256[6] memory want = [uint256(11_000), 12_000, 13_000, 14_000, 15_000, 15_000];
        for (uint256 i; i < want.length; ++i) {
            _nextDay();
            assertEq(_play(alice, true), base * want[i] / 10_000);
        }
        (uint32 len, bool today) = run.streakOf(alice);
        assertEq(len, 7);
        assertTrue(today);
    }

    function test_missingADayStartsAgain() public {
        _play(alice, true);
        _nextDay();
        _play(alice, true);
        (uint32 len,) = run.streakOf(alice);
        assertEq(len, 2);
        _nextDay();
        _nextDay(); // skipped a day
        (len,) = run.streakOf(alice);
        assertEq(len, 0);
        assertEq(_play(alice, true), 5000e18);
        (len,) = run.streakOf(alice);
        assertEq(len, 1);
    }

    function test_onlyAFinishedRunCountsAndOnlyOnceADay() public {
        _play(alice, true);
        _nextDay();
        // a lost run: no streak step, no bonus
        assertEq(_play(alice, false), 5000e18);
        (uint32 len, bool today) = run.streakOf(alice);
        assertEq(len, 1);
        assertFalse(today);
        // the finish steps it, and later runs that day keep the bonus without stepping again
        uint256 m = _play(alice, true);
        (len, today) = run.streakOf(alice);
        assertEq(len, 2);
        assertTrue(today);
        assertEq(m, uint256(4600e18) * 11_000 / 10_000); // second run today: 92% of 5000 ranked, +10% in HAM Points
        _play(alice, true);
        (len,) = run.streakOf(alice);
        assertEq(len, 2);
    }

    function test_streakNeverChangesRankedPoints() public {
        for (uint256 i; i < 4; ++i) {
            _play(alice, true);
            _nextDay();
        }
        uint256 day = run.currentDay();
        uint256 tokenId = _play2(alice, day);
        uint256 bobToken = _play2(bob, day);
        (,,, uint32 aRanked,,,,) = run.scores(tokenId);
        (,,, uint32 bRanked,,,,) = run.scores(bobToken);
        assertEq(aRanked, bRanked); // alice on a 5-day streak ranks exactly like bob on day 1
    }

    function _play2(address p, uint256 day) internal returns (uint256 tokenId) {
        uint32 attempt = run.attempts(day, p);
        bytes32 h = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", run.runDigest(day, p, attempt, 5000, 90_000, 2, true, 0)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(refereeKey, h);
        vm.prank(p);
        tokenId = run.playRun{value: FEE}(
            HamRobinhood.RunResult({points: 5000, timeMs: 90_000, kills: 2, completed: true, attempt: attempt, boostBps: 0}),
            abi.encodePacked(r, s, v), address(0)
        );
    }

    function test_bonusTable() public view {
        assertEq(run.streakBonusBps(0), 0);
        assertEq(run.streakBonusBps(1), 0);
        assertEq(run.streakBonusBps(2), 1000);
        assertEq(run.streakBonusBps(6), 5000);
        assertEq(run.streakBonusBps(400), 5000);
    }
}
