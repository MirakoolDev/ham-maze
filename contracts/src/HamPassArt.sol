// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

/// The FundingWorks campaign's pass reads (https://www.funding.works/how-it-works/pass-art).
interface IFundingWorksPass {
    function initialLockedPerToken() external view returns (uint256);
    function getRemainingLockedEth(uint256 tokenId) external view returns (uint256);
    function vestingEndDate() external view returns (uint256);
}

/// @title HAM backer pass art
/// @notice The "Contract" pass art for HAM's FundingWorks campaign: the game's goal, the orange glass monolith,
/// drawn as an empty glass column on a slab of maze concrete in the Dusk room. Orange fills it from the bottom
/// as the pass's ETH streams to the creator; at 100% it is full. Everything is drawn here, on chain.
/// @dev Deploy first (FundingWorks asks for the address when the campaign is created), then point it at the
/// campaign once with setCampaign. Until then every pass shows 0% streamed.
contract HamPassArt {
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
            '","description":"A backer pass for HAM, the daily maze shooter (ham3d.fun). Backers take 10% of every daily pot while the stream runs. The monolith fills with orange as the pass streams.",',
            '"attributes":[{"trait_type":"Streamed","value":', _u(pct), ',"max_value":100}],',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg(tokenId))), '"}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    /// @notice The pass picture, 600 x 600.
    function svg(uint256 tokenId) public view returns (string memory) {
        uint256 pct = streamed(tokenId);
        string memory s = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><defs>",
            "<linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#7c9fd9'/><stop offset='1' stop-color='#f4d0bb'/></linearGradient>",
            "<filter id='b18' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='18'/></filter>",
            "<filter id='b30' x='-60%' y='-60%' width='220%' height='220%'><feGaussianBlur stdDeviation='30'/></filter>",
            "<filter id='n' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch' seed='",
            _u(tokenId % 97),
            "'/><feColorMatrix type='matrix' values='1 0 0 0 0  1 0 0 0 0  1 0 0 0 0  0 0 0 0 0.07'/></filter>",
            "<linearGradient id='or' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='#ff5a12'/><stop offset='1' stop-color='#ffb47a'/></linearGradient>",
            "</defs><rect width='600' height='600' fill='url(#bg)'/>",
            // the slab of maze concrete: blue z face, pink x face, white top, and its shadow
            "<ellipse cx='300' cy='438.9' rx='156' ry='33.28' fill='#000' opacity='.18' filter='url(#b18)'/>",
            "<polygon points='152.9,330 300,414.9 300,380.9 152.9,296' fill='#bcd7f2'/>",
            "<polygon points='447.1,330 300,414.9 300,380.9 447.1,296' fill='#f2c4d4'/>",
            "<polygon points='300,211.1 447.1,296 300,380.9 152.9,296' fill='#f7f2ee'/>"
        );
        return string.concat(s, _fill(pct), _glass(), _text(tokenId, pct), "</svg>");
    }

    // ── drawing ────────────────────────────────────────────────────────────────
    /// The orange inside the glass and its glow. Heights in tenths of a pixel.
    function _fill(uint256 pct) internal pure returns (string memory) {
        uint256 f = (2420 * pct) / 100;
        if (f < 60) f = 60;
        string memory top = string.concat(
            "<polygon points='300,", _d(2715 - f), " 342.4,", _d(2960 - f), " 300,", _d(3205 - f), " 257.6,", _d(2960 - f), "' fill='#ffc9a0' opacity='.95'/>"
        );
        return string.concat(
            "<ellipse cx='300' cy='", _d(2960 - (6 * f) / 10), "' rx='", _d(700 + 6 * pct), "' ry='", _u(110 + pct),
            "' fill='#ff6a1f' opacity='0.", _u3(180 + (pct * 10) / 3), "' filter='url(#b30)'/>",
            "<polygon points='257.6,296 300,320.5 300,", _d(3205 - f), " 257.6,", _d(2960 - f), "' fill='url(#or)' opacity='.95'/>",
            "<polygon points='342.4,296 300,320.5 300,", _d(3205 - f), " 342.4,", _d(2960 - f), "' fill='#ff7f3a' opacity='.95'/>",
            top
        );
    }

    /// The empty glass column, 250 tall, its bright front edge, and the paper grain over everything.
    function _glass() internal pure returns (string memory) {
        string memory g = "' fill='#fff' opacity='.22' stroke='#fff' stroke-opacity='.7' stroke-width='1.2'/>";
        return string.concat(
            "<polygon points='257.6,296 300,320.5 300,70.5 257.6,46", g,
            "<polygon points='342.4,296 300,320.5 300,70.5 342.4,46", g,
            "<polygon points='300,21.5 342.4,46 300,70.5 257.6,46", g,
            "<line x1='300' y1='320.5' x2='300' y2='70.5' stroke='#fff' stroke-opacity='.9' stroke-width='1.5'/>",
            "<rect width='600' height='600' filter='url(#n)'/>"
        );
    }

    function _text(uint256 tokenId, uint256 pct) internal view returns (string memory) {
        return string.concat(
            "<g font-family=\"Jost, Futura, 'Avenir Next', 'Century Gothic', sans-serif\" fill='#1d1b27'>",
            "<text x='40' y='52' font-size='15' font-weight='600' letter-spacing='4'>HAM</text>",
            "<text x='40' y='72' font-size='11' letter-spacing='2.6' opacity='.72'>BACKER PASS</text>",
            "<text x='560' y='52' font-size='12' font-weight='600' letter-spacing='2.6' text-anchor='end'>NO. ", _u(tokenId), "</text>",
            "<text x='560' y='72' font-size='11' letter-spacing='2.6' opacity='.72' text-anchor='end'>DUSK</text>",
            "<text x='38' y='532' font-size='56' font-weight='300'>", _u(pct), "%</text>",
            "<text x='40' y='560' font-size='11' letter-spacing='2.4' opacity='.8'>STREAMED &#183; 10% OF EVERY POT", _until(), "</text>",
            "<text x='560' y='560' font-size='11' font-weight='600' letter-spacing='2.4' text-anchor='end'>MAZE OR MONEY</text></g>"
        );
    }

    /// " UNTIL MAY 2027", from the campaign's stream end; empty when it can't be read.
    function _until() internal view returns (string memory) {
        if (address(campaign) == address(0)) return " WHILE THE STREAM RUNS";
        try campaign.vestingEndDate() returns (uint256 t) {
            if (t == 0) return " WHILE THE STREAM RUNS";
            (uint256 y, uint256 m) = _ym(t / 1 days);
            string[12] memory names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
            return string.concat(" UNTIL ", names[m - 1], " ", _u(y));
        } catch {
            return " WHILE THE STREAM RUNS";
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

    /// Tenths as "12.3" (or "12" when whole).
    function _d(uint256 v) internal pure returns (string memory) {
        return v % 10 == 0 ? _u(v / 10) : string.concat(_u(v / 10), ".", _u(v % 10));
    }

    /// Below 1000, zero padded to three digits (for a decimal fraction).
    function _u3(uint256 v) internal pure returns (string memory) {
        return v < 10 ? string.concat("00", _u(v)) : v < 100 ? string.concat("0", _u(v)) : _u(v);
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
