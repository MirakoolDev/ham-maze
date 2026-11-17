// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HamPowerUpMutable
/// @notice Same free-mint, one-per-wallet, capped-supply booster NFT as HamPowerUp, but this one
/// levels up. The registered `game` contract (HamRobinhood) calls `recordRun` after every run a
/// holder plays, accumulating lifetime kills and completed mazes on the token itself, and the
/// art changes at two thresholds. Nobody but `game` can write to a token's stats, so they can't
/// be inflated by calling in directly.
///
/// A wallet is tracked by its first token (`tokenOf`): if it later also receives a second one by
/// trade, only the first keeps accumulating stats. Holding any HamPowerUpMutable still counts for
/// HamRobinhood's booster system (balanceOf > 0), this limitation only affects which specific
/// token's SVG keeps leveling up.
contract HamPowerUpMutable {
    string public constant name = "HAM Power-Up";
    string public constant symbol = "HAMPUP";
    uint256 public constant MAX_SUPPLY = 500;
    uint32 public constant SILVER_AT = 10; // lifetime mazes completed
    uint32 public constant GOLD_AT = 50;

    struct Stats {
        uint32 kills;
        uint32 mazesCompleted;
    }

    address public owner;
    address public game; // the only address allowed to call recordRun

    uint256 public totalSupply;
    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => Stats) public stats;
    mapping(address => uint256) public tokenOf; // wallet -> the one token that keeps leveling for it

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event RunRecorded(uint256 indexed tokenId, uint32 kills, uint32 mazesCompleted);
    event GameSet(address game);
    event OwnerSet(address owner);

    error SoldOut();
    error AlreadyMinted();
    error NotOwner();
    error NotGame();
    error NotAuthorized();
    error ZeroAddress();
    error NoSuchToken();
    error NotERC721Receiver();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerSet(owner_);
    }

    /// @notice Free, one per wallet, while supply lasts. This is the only way to get one.
    function mint() external returns (uint256 tokenId) {
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        tokenId = totalSupply + 1;
        if (tokenId > MAX_SUPPLY) revert SoldOut();
        totalSupply = tokenId;
        hasMinted[msg.sender] = true;
        _owner[tokenId] = msg.sender;
        _balance[msg.sender] += 1;
        tokenOf[msg.sender] = tokenId;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    /// @notice Called by `game` after a holder finishes a run. A no-op if the player holds
    /// no token, and never reverts for a caller other than `game` in a way that could brick the
    /// caller's own transaction - HamRobinhood calls this in a try/catch regardless.
    function recordRun(address player, uint32 kills, bool completedMaze) external {
        if (msg.sender != game) revert NotGame();
        uint256 tokenId = tokenOf[player];
        if (tokenId == 0 || _owner[tokenId] != player) return;
        Stats storage s = stats[tokenId];
        s.kills += kills;
        if (completedMaze) s.mazesCompleted += 1;
        emit RunRecorded(tokenId, s.kills, s.mazesCompleted);
    }

    function setGame(address game_) external onlyOwner {
        if (game_ == address(0)) revert ZeroAddress();
        game = game_;
        emit GameSet(game_);
    }

    function transferOwner(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        owner = to;
        emit OwnerSet(to);
    }

    // ── minimal ERC-721 ──────────────────────────────────────────────────────────
    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balance[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _owner[tokenId];
        if (holder == address(0)) revert NoSuchToken();
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && !_operator[holder][msg.sender]) revert NotAuthorized();
        _approved[tokenId] = to;
        emit Approval(holder, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operator[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address holder, address operator) external view returns (bool) {
        return _operator[holder][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (ownerOf(tokenId) != from) revert NotAuthorized();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && msg.sender != _approved[tokenId] && !_operator[from][msg.sender]) revert NotAuthorized();
        delete _approved[tokenId];
        _balance[from] -= 1;
        _balance[to] += 1;
        _owner[tokenId] = to;
        // the first token a wallet ever holds is the one that keeps leveling for it
        if (tokenOf[from] == tokenId) tokenOf[from] = 0;
        if (tokenOf[to] == 0) tokenOf[to] = tokenId;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        transferFrom(from, to, tokenId);
        if (to.code.length > 0) {
            try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 ret) {
                if (ret != IERC721Receiver.onERC721Received.selector) revert NotERC721Receiver();
            } catch {
                revert NotERC721Receiver();
            }
        }
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }

    /// @notice Fully on-chain metadata and art. Tier (and border colour) rises with lifetime
    /// mazes completed, so the NFT visibly changes as you keep playing instead of staying static.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId); // reverts if it does not exist
        Stats memory s = stats[tokenId];
        (string memory tier, string memory color) = _tierOf(s.mazesCompleted);
        string memory idStr = _toString(tokenId);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
            '<rect width="200" height="200" rx="28" fill="#2a2733"/>',
            '<rect x="14" y="14" width="172" height="172" rx="20" fill="none" stroke="', color, '" stroke-width="3"/>',
            '<text x="100" y="80" font-family="monospace" font-size="28" font-weight="700" fill="#f6e4b4" text-anchor="middle">HAM</text>',
            '<text x="100" y="106" font-family="monospace" font-size="12" letter-spacing="2" fill="', color, '" text-anchor="middle">', tier, ' POWER-UP</text>',
            '<text x="100" y="134" font-family="monospace" font-size="12" fill="#fffaf2" text-anchor="middle" opacity="0.85">', _toString(s.mazesCompleted), ' mazes &middot; ', _toString(s.kills), ' kills</text>',
            '<text x="100" y="178" font-family="monospace" font-size="11" fill="#fffaf2" text-anchor="middle" opacity="0.7">No. ', idStr, ' / ', _toString(MAX_SUPPLY), '</text>',
            '</svg>'
        );
        string memory json = string.concat(
            '{"name":"HAM Power-Up #', idStr,
            '","description":"Boosts your points on every HAM run while you hold it, and levels up as you play: lifetime kills and mazes completed are stored on chain.",',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg)), '",',
            '"attributes":[{"trait_type":"Tier","value":"', tier,
            '"},{"trait_type":"Mazes completed","value":', _toString(s.mazesCompleted),
            '},{"trait_type":"Kills","value":', _toString(s.kills), '}]}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    function _tierOf(uint32 mazesCompleted) internal pure returns (string memory tier, string memory color) {
        if (mazesCompleted >= GOLD_AT) return ("GOLD", "#f6e4b4");
        if (mazesCompleted >= SILVER_AT) return ("SILVER", "#d8d8e0");
        return ("BRONZE", "#ff8fa6");
    }

    function _toString(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        uint256 n = v;
        uint256 len;
        while (n != 0) { len++; n /= 10; }
        bytes memory buf = new bytes(len);
        while (v != 0) { len--; buf[len] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(buf);
    }

    function _base64(bytes memory data) private pure returns (string memory) {
        bytes memory alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        if (data.length == 0) return "";
        uint256 encodedLen = 4 * ((data.length + 2) / 3);
        bytes memory result = new bytes(encodedLen);
        uint256 i; uint256 j;
        for (; i + 3 <= data.length; i += 3) {
            (result[j], result[j + 1], result[j + 2], result[j + 3]) = _chunk(data[i], data[i + 1], data[i + 2], alphabet);
            j += 4;
        }
        if (data.length - i == 1) {
            (bytes1 a, bytes1 b,,) = _chunk(data[i], 0, 0, alphabet);
            result[j] = a; result[j + 1] = b; result[j + 2] = "="; result[j + 3] = "=";
        } else if (data.length - i == 2) {
            (bytes1 a, bytes1 b, bytes1 c,) = _chunk(data[i], data[i + 1], 0, alphabet);
            result[j] = a; result[j + 1] = b; result[j + 2] = c; result[j + 3] = "=";
        }
        return string(result);
    }

    function _chunk(bytes1 b0, bytes1 b1, bytes1 b2, bytes memory alphabet) private pure returns (bytes1, bytes1, bytes1, bytes1) {
        uint256 n = (uint256(uint8(b0)) << 16) | (uint256(uint8(b1)) << 8) | uint256(uint8(b2));
        return (
            alphabet[(n >> 18) & 0x3F],
            alphabet[(n >> 12) & 0x3F],
            alphabet[(n >> 6) & 0x3F],
            alphabet[n & 0x3F]
        );
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
