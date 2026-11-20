// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// The FundingWorks campaign's pass reads (https://www.funding.works/how-it-works/pass-art).
interface IFundingWorksPass {
    function initialLockedPerToken() external view returns (uint256);
    function getRemainingLockedEth(uint256 tokenId) external view returns (uint256);
    function vestingEndDate() external view returns (uint256);
}

/// @title HAM backer pass art
/// @notice The "Contract" pass art for HAM's FundingWorks campaign. Each pass draws its own maze (seeded by
/// its token id) seen from above, pink and blue walls like the game's. An orange trail runs from the entrance
/// towards the monolith at the centre, and it grows as the pass's ETH streams to the creator: at 100% it has
/// reached the monolith. Everything is drawn here, on chain; nothing is fetched.
/// @dev Deploy first (FundingWorks asks for the address when the campaign is created), then point it at the
/// campaign once with setCampaign. Until then every pass shows 0% streamed.
contract HamPassArt {
    uint256 internal constant N = 9; // cells per side; odd so the monolith sits in the middle cell
    uint256 internal constant CELL = 76;
    uint256 internal constant X0 = 158;
    uint256 internal constant Y0 = 92;

    address public owner;
    IFundingWorksPass public campaign;

    event CampaignSet(address campaign);

    error NotOwner();
    error CampaignAlreadySet();

    constructor() {
        owner = msg.sender;
    }

    /// @notice Point the art at the campaign. Once only.
    function setCampaign(IFundingWorksPass campaign_) external {
        if (msg.sender != owner) revert NotOwner();
        if (address(campaign) != address(0)) revert CampaignAlreadySet();
        campaign = campaign_;
        emit CampaignSet(address(campaign_));
    }

    /// @notice Percent of this pass's ETH streamed so far, 0 to 100 (0 until the campaign is set).
    function streamed(uint256 tokenId) public view returns (uint256) {
        if (address(campaign) == address(0)) return 0;
        try campaign.initialLockedPerToken() returns (uint256 start) {
            if (start == 0) return 0;
            try campaign.getRemainingLockedEth(tokenId) returns (uint256 left) {
                return left >= start ? 0 : 100 - (left * 100) / start;
            } catch {
                return 0;
            }
        } catch {
            return 0;
        }
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        uint256 pct = streamed(tokenId);
        string memory json = string.concat(
            '{"name":"HAM Backer Pass #', _u(tokenId),
            '","description":"A backer pass for HAM, the daily maze shooter (ham3d.fun). Backers take 10% of every daily pot while the stream runs. The trail reaches the monolith as the pass streams.",',
            '"attributes":[{"trait_type":"Streamed","value":', _u(pct), ',"max_value":100}],',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg(tokenId))), '"}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    /// @notice The pass picture, 1000 x 1000.
    function svg(uint256 tokenId) public view returns (string memory) {
        uint256 pct = streamed(tokenId);
        (uint8[81] memory c, uint8[81] memory path, uint256 len) = _maze(tokenId);
        uint256 lit = pct == 0 ? 1 : 1 + ((len - 1) * pct) / 100; // cells of the path the trail covers
        bool home = lit >= len;

        string memory s = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 1000' font-family='Georgia,serif'>",
            "<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#a9c4e6'/><stop offset='1' stop-color='#e8eef4'/></linearGradient>",
            "<radialGradient id='glow'><stop offset='0' stop-color='#ff7a3d' stop-opacity='",
            home ? ".9" : ".55",
            "'/><stop offset='1' stop-color='#ff7a3d' stop-opacity='0'/></radialGradient></defs>",
            "<rect width='1000' height='1000' fill='#8a837b'/>",
            "<rect x='126' y='60' width='748' height='748' rx='28' fill='url(#sky)'/>",
            "<rect x='", _u(X0), "' y='", _u(Y0), "' width='684' height='684' rx='8' fill='#f3ede4'/>"
        );
        s = string.concat(s, _trail(path, lit), _walls(c), _monolith(home));
        s = string.concat(
            s,
            "<circle cx='", _u(X0 + CELL / 2), "' cy='", _u(Y0 + CELL / 2), "' r='12' fill='#ff7a3d'/>",
            "<text x='126' y='892' font-size='72' font-weight='700' fill='#f6e4b4' letter-spacing='4'>HAM</text>",
            "<text x='874' y='870' font-size='30' fill='#fffaf2' text-anchor='end' letter-spacing='3'>BACKER PASS</text>",
            "<text x='874' y='912' font-size='34' font-weight='700' fill='#f6e4b4' text-anchor='end'>#", _u(tokenId), "</text>",
            "<text x='126' y='950' font-size='24' fill='#fffaf2' fill-opacity='.78'>Streamed ", _u(pct), "%  &#183;  10% of every pot", _until(), "</text>",
            "</svg>"
        );
        return s;
    }

    // ── drawing ────────────────────────────────────────────────────────────────
    function _trail(uint8[81] memory path, uint256 lit) internal pure returns (string memory s) {
        s = "<polyline fill='none' stroke='#ff8a5c' stroke-width='22' stroke-linecap='round' stroke-linejoin='round' stroke-opacity='.9' points='";
        for (uint256 i; i < lit; ++i) {
            uint256 k = path[i];
            s = string.concat(s, i == 0 ? "" : " ", _u(X0 + (k % N) * CELL + CELL / 2), ",", _u(Y0 + (k / N) * CELL + CELL / 2));
        }
        s = string.concat(s, "'/>");
    }

    /// Horizontal walls pink, vertical walls blue: the game's wall tops and faces.
    function _walls(uint8[81] memory c) internal pure returns (string memory s) {
        string memory h = "<path stroke='#c993ae' stroke-width='12' stroke-linecap='round' fill='none' d='";
        string memory v = "<path stroke='#8fb3dc' stroke-width='12' stroke-linecap='round' fill='none' d='";
        for (uint256 k; k < 81; ++k) {
            uint256 x = X0 + (k % N) * CELL;
            uint256 y = Y0 + (k / N) * CELL;
            // bit 1 = north, 2 = south, 4 = east, 8 = west; each wall drawn once (north and west, plus the far edges)
            if (c[k] & 1 != 0) h = string.concat(h, "M", _u(x), " ", _u(y), "h76");
            if (k / N == N - 1 && c[k] & 2 != 0) h = string.concat(h, "M", _u(x), " ", _u(y + CELL), "h76");
            if (c[k] & 8 != 0 && k != 0) v = string.concat(v, "M", _u(x), " ", _u(y), "v76");
            if (k % N == N - 1 && c[k] & 4 != 0) v = string.concat(v, "M", _u(x + CELL), " ", _u(y), "v76");
        }
        s = string.concat(h, "'/>", v, "'/>");
    }

    function _monolith(bool home) internal pure returns (string memory) {
        uint256 cx = X0 + (N / 2) * CELL + CELL / 2;
        uint256 cy = Y0 + (N / 2) * CELL + CELL / 2;
        return string.concat(
            "<circle cx='", _u(cx), "' cy='", _u(cy), "' r='", home ? "120" : "80", "' fill='url(#glow)'/>",
            "<rect x='", _u(cx - 20), "' y='", _u(cy - 20), "' width='40' height='40' rx='4' fill='#ff6a3d'/>",
            "<rect x='", _u(cx - 20), "' y='", _u(cy - 20), "' width='40' height='14' rx='4' fill='#ffb08a'/>"
        );
    }

    /// " until May 2027", from the campaign's stream end; empty when it can't be read.
    function _until() internal view returns (string memory) {
        if (address(campaign) == address(0)) return " while the stream runs";
        try campaign.vestingEndDate() returns (uint256 t) {
            if (t == 0) return " while the stream runs";
            (uint256 y, uint256 m) = _ym(t / 1 days);
            string[12] memory names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
            return string.concat(" until ", names[m - 1], " ", _u(y));
        } catch {
            return " while the stream runs";
        }
    }

    // ── the maze: recursive backtracker from the top-left cell; the path is the stack when it first
    //    reaches the middle cell ─────────────────────────────────────────────────────
    function _maze(uint256 tokenId) internal pure returns (uint8[81] memory c, uint8[81] memory path, uint256 len) {
        for (uint256 i; i < 81; ++i) c[i] = 15;
        uint8[81] memory stack;
        bool[81] memory seen;
        uint256 sp = 1;
        seen[0] = true;
        uint256 goal = (N / 2) * N + N / 2;
        uint256 seed = uint256(keccak256(abi.encode("HAM_PASS", tokenId)));
        uint256 n;
        while (sp > 0) {
            uint256 cur = stack[sp - 1];
            if (cur == goal && len == 0) {
                len = sp;
                for (uint256 i; i < sp; ++i) path[i] = stack[i];
            }
            uint256 x = cur % N;
            uint256 y = cur / N;
            uint256[4] memory u;
            uint256 m;
            if (y >= 1 && !seen[cur - N]) u[m++] = cur - N;
            if (y + 1 < N && !seen[cur + N]) u[m++] = cur + N;
            if (x + 1 < N && !seen[cur + 1]) u[m++] = cur + 1;
            if (x >= 1 && !seen[cur - 1]) u[m++] = cur - 1;
            if (m == 0) {
                --sp;
                continue;
            }
            uint256 nx = u[uint256(keccak256(abi.encode(seed, n++))) % m];
            if (nx + N == cur) { c[cur] &= ~uint8(1); c[nx] &= ~uint8(2); }
            else if (nx == cur + N) { c[cur] &= ~uint8(2); c[nx] &= ~uint8(1); }
            else if (nx == cur + 1) { c[cur] &= ~uint8(4); c[nx] &= ~uint8(8); }
            else { c[cur] &= ~uint8(8); c[nx] &= ~uint8(4); }
            seen[nx] = true;
            stack[sp++] = uint8(nx);
        }
    }

    // ── helpers ────────────────────────────────────────────────────────────────
    function _ym(uint256 day) internal pure returns (uint256 y, uint256 m) {
        // days since 1970-01-01 to a civil year and month (Howard Hinnant's algorithm)
        uint256 z = day + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        m = mp < 10 ? mp + 3 : mp - 9;
        y = yoe + era * 400 + (m <= 2 ? 1 : 0);
    }

    function _u(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) { ++len; j /= 10; }
        bytes memory b = new bytes(len);
        while (v != 0) { b[--len] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }

    function _base64(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        string memory table = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        string memory result = new string(4 * ((data.length + 2) / 3));
        assembly {
            let tablePtr := add(table, 1)
            let resultPtr := add(result, 32)
            for { let dataPtr := data let endPtr := add(data, mload(data)) } lt(dataPtr, endPtr) {} {
                dataPtr := add(dataPtr, 3)
                let input := mload(dataPtr)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(18, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(12, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(shr(6, input), 0x3F))))
                resultPtr := add(resultPtr, 1)
                mstore8(resultPtr, mload(add(tablePtr, and(input, 0x3F))))
                resultPtr := add(resultPtr, 1)
            }
            switch mod(mload(data), 3)
            case 1 { mstore8(sub(resultPtr, 1), 0x3d) mstore8(sub(resultPtr, 2), 0x3d) }
            case 2 { mstore8(sub(resultPtr, 1), 0x3d) }
        }
        return result;
    }
}
