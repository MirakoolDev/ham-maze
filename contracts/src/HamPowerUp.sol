// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HamPowerUp
/// @notice A free-mint NFT that does something real in HAM: holding one plugs straight into
/// HamDailyRun's booster system (any token with balanceOf works there) and adds a points bonus
/// to every daily run while you hold it, for real money from the day's pot. One per wallet, a
/// capped supply, fully on-chain metadata (no off-chain hosting to go stale or disappear).
/// Minimal ERC-721, written by hand instead of pulling in a dependency, so it stays small and
/// auditable in one file. Supports the standard interface plus a correct safeTransferFrom check.
contract HamPowerUp {
    string public constant name = "HAM Power-Up";
    string public constant symbol = "HAMPUP";
    uint256 public constant MAX_SUPPLY = 500;

    uint256 public totalSupply;
    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    mapping(address => bool) public hasMinted;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    error SoldOut();
    error AlreadyMinted();
    error NotOwner();
    error NotAuthorized();
    error ZeroAddress();
    error NoSuchToken();
    error NotERC721Receiver();

    /// @notice Free, one per wallet, while supply lasts. This is the only way to get one.
    function mint() external returns (uint256 tokenId) {
        if (hasMinted[msg.sender]) revert AlreadyMinted();
        tokenId = totalSupply + 1;
        if (tokenId > MAX_SUPPLY) revert SoldOut();
        totalSupply = tokenId;
        hasMinted[msg.sender] = true;
        _owner[tokenId] = msg.sender;
        _balance[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balance[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owner[tokenId];
        if (owner == address(0)) revert NoSuchToken();
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operator[owner][msg.sender]) revert NotAuthorized();
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId); // reverts if it does not exist
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operator[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operator[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (ownerOf(tokenId) != from) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && msg.sender != _approved[tokenId] && !_operator[from][msg.sender]) revert NotAuthorized();
        delete _approved[tokenId];
        _balance[from] -= 1;
        _balance[to] += 1;
        _owner[tokenId] = to;
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
        return id == 0x01ffc9a7 // ERC165
            || id == 0x80ac58cd // ERC721
            || id == 0x5b5e139f; // ERC721Metadata
    }

    /// @notice Fully on-chain metadata and art - nothing off-chain to go missing.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId); // reverts if it does not exist
        string memory idStr = _toString(tokenId);
        string memory svg = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">',
            '<rect width="200" height="200" rx="28" fill="#2a2733"/>',
            '<rect x="14" y="14" width="172" height="172" rx="20" fill="none" stroke="#ff8fa6" stroke-width="3"/>',
            '<text x="100" y="92" font-family="monospace" font-size="30" font-weight="700" fill="#f6e4b4" text-anchor="middle">HAM</text>',
            '<text x="100" y="122" font-family="monospace" font-size="13" letter-spacing="2" fill="#ff8fa6" text-anchor="middle">POWER-UP</text>',
            '<text x="100" y="178" font-family="monospace" font-size="11" fill="#fffaf2" text-anchor="middle" opacity="0.7">No. ', idStr, ' / ', _toString(MAX_SUPPLY), '</text>',
            '</svg>'
        );
        string memory json = string.concat(
            '{"name":"HAM Power-Up #', idStr,
            '","description":"Boosts your points on every HAM daily run while you hold it. Plugs into HamDailyRun as a booster: real points, real money from the day\'s pot.",',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg)), '",',
            '"attributes":[{"trait_type":"Game","value":"HAM"},{"trait_type":"Effect","value":"Points booster"}]}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
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
