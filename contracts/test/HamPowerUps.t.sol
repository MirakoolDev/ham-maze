// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HamPowerUps} from "../src/HamPowerUps.sol";

contract HamPowerUpsTest is Test {
    HamPowerUps pu;
    address owner = makeAddr("owner");
    address game = makeAddr("game");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    string[5] keys = ["marker", "frost", "pulse", "blinker", "snare"];
    uint256 constant DAY0 = 20_000 days; // a clean 00:00 UTC

    function setUp() public {
        vm.warp(DAY0);
        vm.roll(100);
        pu = new HamPowerUps(owner);
        vm.startPrank(owner);
        pu.setGame(game);
        pu.addKind("Marker", "COMMON", 4000);
        pu.addKind("Frost dart", "RARE", 2000);
        pu.addKind("Pulse", "RARE", 2000);
        pu.addKind("Blinker", "EPIC", 1000);
        pu.addKind("Snare", "EPIC", 1000);
        vm.stopPrank();
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
    }

    function _uploadArt() internal {
        vm.startPrank(owner);
        pu.setArt(0, bytes(vm.readFile("./art/pack.head.svg")), bytes(vm.readFile("./art/pack.tail.svg")));
        for (uint256 i; i < 5; ++i) {
            pu.setArt(
                i + 1,
                bytes(vm.readFile(string.concat("./art/", keys[i], ".head.svg"))),
                bytes(vm.readFile(string.concat("./art/", keys[i], ".tail.svg")))
            );
        }
        vm.stopPrank();
    }

    function _open() internal {
        vm.prank(owner);
        pu.lock();
    }

    function _buy(address who, uint256 count) internal returns (uint256 first) {
        (uint256 cost,) = pu.quote(count);
        vm.prank(who);
        first = pu.buy{value: cost}(count);
    }

    function _openPack(address who, uint256 tokenId) internal returns (uint256 kind) {
        vm.prank(who);
        kind = pu.open(tokenId);
    }

    // ── sale ────────────────────────────────────────────────────────────────────
    function test_noSalesBeforeTheLineupIsLocked() public {
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.NotOpenYet.selector);
        pu.buy{value: 1 ether}(1);
    }

    function test_lockNeedsTheCapsToAddUpToTenThousand() public {
        HamPowerUps other = new HamPowerUps(owner);
        vm.startPrank(owner);
        other.addKind("Marker", "COMMON", 9999);
        vm.expectRevert(HamPowerUps.BadCaps.selector);
        other.lock();
        other.addKind("Snare", "EPIC", 1);
        other.lock();
        vm.stopPrank();
    }

    function test_priceGoesTenTimesPerHundredSoldAndResetsAtMidnight() public {
        _open();
        uint256 base = pu.basePrice();
        assertEq(pu.priceNow(), base, "first pack of the day");
        vm.warp(DAY0 + 20 hours);
        assertEq(pu.priceNow(), base, "time alone moves nothing");
        for (uint256 i; i < 5; ++i) _buy(alice, 20);
        assertApproxEqRel(pu.priceNow(), base * 10, 1e12, "x10 after 100 packs");
        for (uint256 i; i < 5; ++i) _buy(bob, 20);
        assertApproxEqRel(pu.priceNow(), base * 100, 1e12, "x100 after 200 packs");
        vm.warp(DAY0 + 1 days);
        assertEq(pu.priceNow(), base, "back down the next day");
    }

    function test_eachPackInOneBuyCostsMoreThanTheLast() public {
        _open();
        (uint256 cost, uint256 next) = pu.quote(3);
        uint256 p0 = pu.basePrice();
        uint256 p1 = p0 * pu.growth() / 1e18;
        uint256 p2 = p1 * pu.growth() / 1e18;
        assertEq(cost, p0 + p1 + p2);
        uint256 before = alice.balance;
        vm.prank(alice);
        pu.buy{value: cost + 0.01 ether}(3);
        assertEq(before - alice.balance, cost, "overpay comes back");
        assertEq(pu.balanceOf(alice), 3);
        assertEq(pu.priceNow(), next);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.WrongPrice.selector);
        pu.buy{value: next - 1}(1);
    }

    function test_cannotSellPastTenThousand() public {
        _open();
        vm.store(address(pu), bytes32(uint256(_slotOfTotalSupply())), bytes32(uint256(9_999)));
        _buy(alice, 1);
        vm.prank(bob);
        vm.expectRevert(HamPowerUps.SoldOut.selector);
        pu.buy{value: 1 ether}(1);
    }

    // ── opening ─────────────────────────────────────────────────────────────────
    function test_openingWaitsForTheNextBlockThenRevealsAGun() public {
        _open();
        uint256 t = _buy(alice, 1);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.TooSoon.selector);
        pu.open(t);
        vm.roll(block.number + 1);
        uint256 kind = _openPack(alice, t);
        assertTrue(kind >= 1 && kind <= 5);
        assertEq(pu.kindOf(t), kind);
        assertEq(pu.equippedKind(alice), kind, "first gun is equipped");
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.AlreadyOpened.selector);
        pu.open(t);
    }

    function test_onlyTheHolderOpens() public {
        _open();
        uint256 t = _buy(alice, 1);
        vm.roll(block.number + 1);
        vm.prank(bob);
        vm.expectRevert(HamPowerUps.NotAuthorized.selector);
        pu.open(t);
    }

    function test_sealedPacksCannotMoveButOpenedGunsCan() public {
        _open();
        uint256 t = _buy(alice, 1);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.StillSealed.selector);
        pu.transferFrom(alice, bob, t);
        vm.roll(block.number + 1);
        uint256 kind = _openPack(alice, t);
        vm.prank(alice);
        pu.transferFrom(alice, bob, t);
        assertEq(pu.equippedKind(alice), 0);
        assertEq(pu.equippedKind(bob), kind, "the buyer carries it if they had none");
    }

    function test_everyOpenedPackComesOutOfTheDeck() public {
        _open();
        _buy(alice, 20);
        _buy(alice, 20);
        vm.roll(block.number + 1);
        for (uint256 t = 1; t <= 40; ++t) _openPack(alice, t);
        HamPowerUps.Kind[] memory ks = pu.kinds();
        uint256 sum;
        for (uint256 i; i < ks.length; ++i) sum += ks[i].minted;
        assertEq(sum, 40);
        assertEq(pu.opened(), 40);
    }

    function test_hashIsKeptForPacksOpenedLate() public {
        _open();
        uint256 t = _buy(alice, 1);
        uint256 boughtIn = block.number;
        vm.roll(block.number + 1);
        _buy(bob, 1); // any later purchase keeps the hash of alice's block
        assertTrue(pu.blockSeal(boughtIn) == blockhash(boughtIn));
        vm.roll(block.number + 1000); // far past the 256-block window
        uint256 kind = _openPack(alice, t);
        assertTrue(kind >= 1 && kind <= 5);
    }

    // ── carrying ────────────────────────────────────────────────────────────────
    function test_runsCountOnTheEquippedGun() public {
        _open();
        _buy(alice, 2);
        vm.roll(block.number + 1);
        _openPack(alice, 1);
        _openPack(alice, 2);
        uint256 sealedOne = _buy(alice, 1);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.StillSealed.selector);
        pu.equip(sealedOne);

        vm.prank(game);
        pu.recordRun(alice, 3, true);
        vm.prank(alice);
        pu.equip(2);
        vm.prank(game);
        pu.recordRun(alice, 5, false);

        (uint32 runs, uint32 kills) = pu.stats(1);
        assertEq(runs, 1);
        assertEq(kills, 3);
        (runs, kills) = pu.stats(2);
        assertEq(runs, 1);
        assertEq(kills, 5);
    }

    function test_onlyGameRecordsRuns() public {
        vm.expectRevert(HamPowerUps.NotGame.selector);
        pu.recordRun(alice, 1, true);
    }

    // ── owner ───────────────────────────────────────────────────────────────────
    function test_lockFreezesLineupAndArt() public {
        _uploadArt();
        _open();
        vm.startPrank(owner);
        vm.expectRevert(HamPowerUps.IsLocked.selector);
        pu.addKind("Decoy", "RARE", 10);
        vm.expectRevert(HamPowerUps.IsLocked.selector);
        pu.setArt(1, "x", "y");
        vm.expectRevert(HamPowerUps.IsLocked.selector);
        pu.setArt(0, "x", "y");
        pu.setPricing(0.001 ether, 1e18); // pricing stays tunable
        vm.stopPrank();
        assertEq(pu.priceNow(), 0.001 ether);
    }

    function test_withdrawGoesWhereTheOwnerSays() public {
        _open();
        (uint256 cost,) = pu.quote(4);
        _buy(alice, 4);
        address vault = makeAddr("vault");
        vm.prank(owner);
        pu.withdraw(vault);
        assertEq(vault.balance, cost);
    }

    // ── art ─────────────────────────────────────────────────────────────────────
    /// @notice A sealed pack and each gun must draw exactly what ham-art.js draws.
    function test_artMatchesTheJsDrawing() public {
        _uploadArt();
        _open();
        _buy(alice, 1);
        assertEq(_image(pu.tokenURI(1)), vm.replace(vm.readFile("./test/fixtures/pack-7.svg"), "NO. 7 OF", "NO. 1 OF"));

        _buy(alice, 20);
        _buy(alice, 20);
        _buy(alice, 20);
        vm.roll(block.number + 1);
        uint256[6] memory firstOf;
        for (uint256 t = 1; t <= 61; ++t) {
            uint256 kind = _openPack(alice, t);
            if (firstOf[kind] == 0) firstOf[kind] = t;
        }
        for (uint256 kind = 1; kind <= 5; ++kind) {
            uint256 t = firstOf[kind];
            assertGt(t, 0, keys[kind - 1]);
            vm.prank(alice);
            pu.equip(t);
            for (uint256 r; r < 12; ++r) {
                vm.prank(game);
                pu.recordRun(alice, 1, false);
            }
            string memory want = vm.readFile(string.concat("./test/fixtures/powerup-", keys[kind - 1], "-7-12.svg"));
            want = vm.replace(want, "NO. 7 &#183;", string.concat("NO. ", vm.toString(t), " &#183;"));
            assertEq(_image(pu.tokenURI(t)), want, keys[kind - 1]);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────
    function _slotOfTotalSupply() internal returns (uint256 slot) {
        // find totalSupply's storage slot by probing, so the test survives layout changes
        uint256 before = pu.totalSupply();
        for (slot = 0; slot < 30; ++slot) {
            bytes32 old = vm.load(address(pu), bytes32(slot));
            vm.store(address(pu), bytes32(slot), bytes32(uint256(424242)));
            bool hit = pu.totalSupply() == 424242;
            vm.store(address(pu), bytes32(slot), old);
            if (hit) return slot;
        }
        assertEq(before, type(uint256).max, "slot not found");
    }

    function _image(string memory uri) internal pure returns (string memory) {
        string memory json = string(vm.parseBytes(_b64Hex(uri, 29)));
        string memory image = _between(json, "data:image/svg+xml;base64,", '"');
        return string(vm.parseBytes(_b64HexStr(image)));
    }

    function _between(string memory s, string memory a, string memory b) internal pure returns (string memory) {
        bytes memory h = bytes(s);
        uint256 start = _find(h, bytes(a), 0) + bytes(a).length;
        uint256 end = _find(h, bytes(b), start);
        bytes memory out = new bytes(end - start);
        for (uint256 i; i < out.length; ++i) out[i] = h[start + i];
        return string(out);
    }

    function _find(bytes memory h, bytes memory n, uint256 from) internal pure returns (uint256) {
        for (uint256 i = from; i + n.length <= h.length; ++i) {
            bool ok = true;
            for (uint256 j; j < n.length && ok; ++j) if (h[i + j] != n[j]) ok = false;
            if (ok) return i;
        }
        revert("not found");
    }

    function _b64Hex(string memory uri, uint256 skip) internal pure returns (string memory) {
        bytes memory u = bytes(uri);
        bytes memory body = new bytes(u.length - skip);
        for (uint256 i; i < body.length; ++i) body[i] = u[skip + i];
        return _b64HexStr(string(body));
    }

    /// @dev base64 decode, returned as a 0x hex string so vm.parseBytes can turn it back into bytes
    function _b64HexStr(string memory b64) internal pure returns (string memory) {
        bytes memory s = bytes(b64);
        bytes memory out = new bytes(s.length / 4 * 3);
        uint256 o;
        for (uint256 i; i < s.length; i += 4) {
            uint256 n;
            uint256 pad;
            for (uint256 j; j < 4; ++j) {
                bytes1 c = s[i + j];
                uint256 v;
                if (c >= "A" && c <= "Z") v = uint8(c) - 65;
                else if (c >= "a" && c <= "z") v = uint8(c) - 71;
                else if (c >= "0" && c <= "9") v = uint8(c) + 4;
                else if (c == "+") v = 62;
                else if (c == "/") v = 63;
                else pad++;
                n = (n << 6) | v;
            }
            out[o++] = bytes1(uint8(n >> 16));
            if (pad < 2) out[o++] = bytes1(uint8(n >> 8));
            if (pad < 1) out[o++] = bytes1(uint8(n));
        }
        assembly {
            mstore(out, o)
        }
        bytes memory hexChars = "0123456789abcdef";
        bytes memory h = new bytes(2 + o * 2);
        h[0] = "0";
        h[1] = "x";
        for (uint256 i; i < o; ++i) {
            h[2 + i * 2] = hexChars[uint8(out[i]) >> 4];
            h[3 + i * 2] = hexChars[uint8(out[i]) & 15];
        }
        return string(h);
    }
}
