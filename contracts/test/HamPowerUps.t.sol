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

    function setUp() public {
        pu = new HamPowerUps(owner);
        vm.startPrank(owner);
        pu.setGame(game);
        pu.addKind("Marker", "COMMON", 200, 0);
        pu.addKind("Frost dart", "RARE", 100, 0.01 ether);
        pu.addKind("Pulse", "RARE", 100, 0.01 ether);
        pu.addKind("Blinker", "EPIC", 2, 0.05 ether);
        pu.addKind("Snare", "EPIC", 50, 0.05 ether);
        vm.stopPrank();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
    }

    function _uploadArt() internal {
        vm.startPrank(owner);
        for (uint256 i; i < 5; ++i) {
            pu.setArt(
                i + 1,
                bytes(vm.readFile(string.concat("./art/", keys[i], ".head.svg"))),
                bytes(vm.readFile(string.concat("./art/", keys[i], ".tail.svg")))
            );
        }
        vm.stopPrank();
    }

    function test_freeKindIsOncePerWallet() public {
        vm.prank(alice);
        pu.mint(1);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.AlreadyClaimed.selector);
        pu.mint(1);
    }

    function test_paidKindNeedsExactPriceAndCanBeBoughtAgain() public {
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.WrongPrice.selector);
        pu.mint{value: 0.001 ether}(2);
        vm.startPrank(alice);
        pu.mint{value: 0.01 ether}(2);
        pu.mint{value: 0.01 ether}(2);
        vm.stopPrank();
        assertEq(pu.balanceOf(alice), 2);
        assertEq(address(pu).balance, 0.02 ether);
    }

    function test_capIsEnforced() public {
        vm.prank(alice);
        pu.mint{value: 0.05 ether}(4);
        vm.prank(bob);
        pu.mint{value: 0.05 ether}(4);
        vm.prank(alice);
        vm.expectRevert(HamPowerUps.SoldOut.selector);
        pu.mint{value: 0.05 ether}(4);
    }

    function test_firstMintIsEquippedAndRunsCountOnIt() public {
        vm.startPrank(alice);
        uint256 marker = pu.mint(1);
        uint256 pulse = pu.mint{value: 0.01 ether}(3);
        vm.stopPrank();
        assertEq(pu.equippedKind(alice), 1);

        vm.prank(game);
        pu.recordRun(alice, 3, true);
        vm.prank(alice);
        pu.equip(pulse);
        vm.prank(game);
        pu.recordRun(alice, 5, false);

        (uint32 runs, uint32 kills) = pu.stats(marker);
        assertEq(runs, 1);
        assertEq(kills, 3);
        (runs, kills) = pu.stats(pulse);
        assertEq(runs, 1);
        assertEq(kills, 5);
        assertEq(pu.equippedKind(alice), 3);
    }

    function test_onlyGameRecordsRuns() public {
        vm.prank(alice);
        pu.mint(1);
        vm.expectRevert(HamPowerUps.NotGame.selector);
        pu.recordRun(alice, 1, true);
    }

    function test_selling_theEquippedOneUnequipsIt() public {
        vm.prank(alice);
        uint256 t = pu.mint(1);
        vm.prank(alice);
        pu.transferFrom(alice, bob, t);
        assertEq(pu.equippedKind(alice), 0);
        assertEq(pu.equippedKind(bob), 1, "the buyer carries it if they had none");
    }

    function test_lockFreezesLineupAndArt() public {
        _uploadArt();
        vm.prank(owner);
        pu.lock();
        vm.startPrank(owner);
        vm.expectRevert(HamPowerUps.IsLocked.selector);
        pu.addKind("Decoy", "RARE", 10, 0);
        vm.expectRevert(HamPowerUps.IsLocked.selector);
        pu.setArt(1, "x", "y");
        vm.stopPrank();
    }

    function test_withdrawGoesWhereTheOwnerSays() public {
        vm.prank(alice);
        pu.mint{value: 0.05 ether}(5);
        address vault = makeAddr("vault");
        vm.prank(owner);
        pu.withdraw(vault);
        assertEq(vault.balance, 0.05 ether);
    }

    /// @notice Token 7, a Marker carried on 12 runs, must draw exactly what ham-art.js draws.
    function test_artMatchesTheJsDrawing() public {
        _uploadArt();
        for (uint256 i; i < 6; ++i) {
            address who = makeAddr(string.concat("p", vm.toString(i)));
            vm.deal(who, 1 ether);
            vm.prank(who);
            pu.mint{value: 0.01 ether}(2);
        }
        for (uint256 kind = 1; kind <= 5; ++kind) {
            // a fresh wallet per kind; token ids 7..11
            address who = makeAddr(string.concat("k", vm.toString(kind)));
            vm.deal(who, 1 ether);
            (,,,, uint96 price,,) = _kindAt(kind);
            vm.prank(who);
            uint256 t = pu.mint{value: price}(kind);
            for (uint256 r; r < 12; ++r) {
                vm.prank(game);
                pu.recordRun(who, 1, false);
            }
            string memory uri = pu.tokenURI(t);
            string memory want = vm.readFile(string.concat("./test/fixtures/powerup-", keys[kind - 1], "-7-12.svg"));
            // the fixture is drawn as token 7; swap the number in for later tokens
            want = vm.replace(want, "NO. 7 &#183;", string.concat("NO. ", vm.toString(t), " &#183;"));
            string memory json = string(vm.parseBytes(_b64Hex(uri, 29)));
            assertTrue(vm.contains(json, '"trait_type":"Runs","value":12'));
            string memory image = _between(json, "data:image/svg+xml;base64,", '"');
            assertEq(string(vm.parseBytes(_b64HexStr(image))), want, keys[kind - 1]);
        }
    }

    // ── helpers ─────────────────────────────────────────────────────────────────
    function _kindAt(uint256 kind)
        internal
        view
        returns (string memory, string memory, uint32, uint32, uint96, address, address)
    {
        HamPowerUps.Kind memory k = pu.kinds()[kind - 1];
        return (k.name, k.rarity, k.cap, k.minted, k.price, k.head, k.tail);
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
