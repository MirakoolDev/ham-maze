// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

interface IPassArt {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

/// @title HAM Backer Pass (Robinhood Chain)
/// @notice The backer perk pass for HAM on Robinhood Chain. Every holder of the FundingWorks backer pass
/// (an Ethereum NFT that can't be transferred) gets this one free, with the same number: pass #3 on
/// Ethereum is pass #3 here. Unlike the FundingWorks pass, this one can be sold.
///
/// HamRobinhood uses it as its holder NFT, so the perks follow whoever holds it: one free run a day per
/// pass, and the holder bonus on a winning run. The backers' 10% of each pot does NOT move with it; that
/// is paid to the FundingWorks pass on Ethereum.
///
/// @dev The owner airdrops passes with `airdrop` after the FundingWorks mint closes, then calls `lockMint`,
/// after which no pass can ever be created. ERC-721 with the Enumerable reads the game client uses to find
/// a wallet's passes.
contract HamBackerPass {
    string public constant name = "HAM Backer Pass";
    string public constant symbol = "HAMBACK";

    address public owner;
    address public pendingOwner;
    bool public mintLocked;
    bool public artLocked;
    IPassArt public art; // draws tokenURI; until set, a plain placeholder
    uint256 public totalSupply;

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    mapping(address => mapping(uint256 => uint256)) private _ownedTokens; // holder => index => tokenId
    mapping(uint256 => uint256) private _ownedIndex; // tokenId => its index in its holder's list
    uint256[] private _allTokens;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event MintLocked();
    event ArtSet(address art);
    event ArtLocked();
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error Locked();
    error AlreadyMinted();
    error BadLength();
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
        emit OwnershipTransferred(address(0), owner_);
    }

    // ── minting: the airdrop, then locked for good ──────────────────────────────
    /// @notice Give pass `ids[i]` to `to[i]`. Each number can only ever be minted once.
    function airdrop(address[] calldata to, uint256[] calldata ids) external onlyOwner {
        if (mintLocked) revert Locked();
        if (to.length != ids.length || to.length == 0) revert BadLength();
        for (uint256 i; i < to.length; ++i) {
            if (to[i] == address(0)) revert ZeroAddress();
            if (_owner[ids[i]] != address(0)) revert AlreadyMinted();
            _allTokens.push(ids[i]);
            _addTo(to[i], ids[i]);
            emit Transfer(address(0), to[i], ids[i]);
        }
        totalSupply += to.length;
    }

    /// @notice No pass can be minted after this. Permanent.
    function lockMint() external onlyOwner {
        mintLocked = true;
        emit MintLocked();
    }

    // ── art ─────────────────────────────────────────────────────────────────────
    function setArt(IPassArt art_) external onlyOwner {
        if (artLocked) revert Locked();
        art = art_;
        emit ArtSet(address(art_));
    }

    function lockArt() external onlyOwner {
        artLocked = true;
        emit ArtLocked();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        if (address(art) != address(0)) return art.tokenURI(tokenId);
        string memory n = _toString(tokenId);
        string memory svg = string.concat(
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 600'><rect width='600' height='600' fill='#2a2733'/>",
            "<text x='300' y='290' font-family='Georgia,serif' font-size='44' fill='#f6e4b4' text-anchor='middle'>HAM Backer Pass</text>",
            "<text x='300' y='350' font-family='Georgia,serif' font-size='32' fill='#ff8fa6' text-anchor='middle'>#", n, "</text></svg>"
        );
        string memory json = string.concat(
            '{"name":"HAM Backer Pass #', n,
            '","description":"A HAM backer pass on Robinhood Chain: one free run a day in HAM (ham3d.fun) and the holder bonus on a winning run, for whoever holds it.",',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg)), '"}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    // ── ownership (two-step) ────────────────────────────────────────────────────
    function transferOwnership(address to) external onlyOwner {
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    // ── ERC-721 + Enumerable ────────────────────────────────────────────────────
    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroAddress();
        return _balance[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _owner[tokenId];
        if (holder == address(0)) revert NoSuchToken();
    }

    function tokenOfOwnerByIndex(address holder, uint256 index) external view returns (uint256) {
        if (index >= _balance[holder]) revert NoSuchToken();
        return _ownedTokens[holder][index];
    }

    function tokenByIndex(uint256 index) external view returns (uint256) {
        if (index >= _allTokens.length) revert NoSuchToken();
        return _allTokens[index];
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
        _removeFrom(from, tokenId);
        _addTo(to, tokenId);
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
        // ERC-165, ERC-721, ERC-721 Metadata, ERC-721 Enumerable
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f || id == 0x780e9d63;
    }

    function _addTo(address to, uint256 tokenId) private {
        uint256 i = _balance[to];
        _ownedTokens[to][i] = tokenId;
        _ownedIndex[tokenId] = i;
        _balance[to] = i + 1;
        _owner[tokenId] = to;
    }

    function _removeFrom(address from, uint256 tokenId) private {
        uint256 last = _balance[from] - 1;
        uint256 i = _ownedIndex[tokenId];
        if (i != last) {
            uint256 moved = _ownedTokens[from][last];
            _ownedTokens[from][i] = moved;
            _ownedIndex[moved] = i;
        }
        delete _ownedTokens[from][last];
        delete _ownedIndex[tokenId];
        _balance[from] = last;
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
        bytes memory result = new bytes(encodedLen + 32);
        assembly {
            let tablePtr := add(alphabet, 1)
            let resultPtr := add(result, 32)
            let end := add(data, mload(data))
            for { let p := data } lt(p, end) {} {
                p := add(p, 3)
                let input := mload(p)
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
            mstore(result, encodedLen)
        }
        return string(result);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
