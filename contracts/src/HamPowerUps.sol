// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HamPowerUps
/// @notice HAM's Power-Ups: tools you keep, like the Marker, Pulse, Blinker or Snare. Everyone starts
/// a run with the free K-7 carbine, which is not an NFT. A Power-Up trades raw damage for one move with
/// a few charges per run, so holding one gives you options rather than a win.
///
/// The lineup is data, not code: the owner adds kinds (name, rarity, supply cap, price) and uploads each
/// kind's art, then calls `lock()`, after which no kind can be added and no art changed. Prices can still
/// be changed after the lock, for new mints only.
///
/// A wallet carries one Power-Up into a run: its equipped token. HamRobinhood calls `recordRun` after
/// each run, which counts runs and kills on that token. Nobody but `game` can write those stats.
contract HamPowerUps {
    string public constant name = "HAM Power-Ups";
    string public constant symbol = "HAMPU";

    struct Kind {
        string name;
        string rarity;
        uint32 cap;
        uint32 minted;
        uint96 price;
        address head; // art before the per-token line, stored as contract code
        address tail; // art after it
    }

    struct Stats {
        uint32 runs;
        uint32 kills;
    }

    address public owner;
    address public game; // the only address allowed to call recordRun
    bool public locked; // lineup and art frozen for good

    Kind[] internal _kinds; // kind id = index + 1
    uint256 public totalSupply;
    mapping(uint256 => uint256) public kindOf; // tokenId => kind id
    mapping(uint256 => Stats) public stats;
    mapping(address => uint256) public equipped; // wallet => tokenId it carries into runs, 0 = none
    mapping(address => mapping(uint256 => bool)) public claimedFree; // wallet => kind => took a free one

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    uint256 private _lock = 1;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event KindAdded(uint256 indexed kind, string name, string rarity, uint32 cap, uint96 price);
    event PriceSet(uint256 indexed kind, uint96 price);
    event ArtSet(uint256 indexed kind, address head, address tail);
    event Locked();
    event Equipped(address indexed holder, uint256 indexed tokenId);
    event RunRecorded(uint256 indexed tokenId, uint32 runs, uint32 kills);
    event GameSet(address game);
    event OwnerSet(address owner);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error NotGame();
    error IsLocked();
    error NoSuchKind();
    error SoldOut();
    error WrongPrice();
    error AlreadyClaimed();
    error NotAuthorized();
    error ZeroAddress();
    error NoSuchToken();
    error NotERC721Receiver();
    error BadArt();
    error TransferFailed();
    error Reentrancy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier unlocked() {
        if (locked) revert IsLocked();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerSet(owner_);
    }

    // ── minting and carrying ─────────────────────────────────────────────────────
    /// @notice Buy one Power-Up of `kind` at its price. A free kind is limited to one per wallet.
    /// Your first Power-Up is equipped automatically.
    function mint(uint256 kind) external payable nonReentrant returns (uint256 tokenId) {
        Kind storage k = _kind(kind);
        if (k.minted >= k.cap) revert SoldOut();
        if (msg.value != k.price) revert WrongPrice();
        if (k.price == 0) {
            if (claimedFree[msg.sender][kind]) revert AlreadyClaimed();
            claimedFree[msg.sender][kind] = true;
        }
        k.minted += 1;
        tokenId = ++totalSupply;
        kindOf[tokenId] = kind;
        _owner[tokenId] = msg.sender;
        _balance[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
        if (equipped[msg.sender] == 0) _equip(msg.sender, tokenId);
    }

    /// @notice Choose which of your Power-Ups you carry into runs.
    function equip(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotAuthorized();
        _equip(msg.sender, tokenId);
    }

    /// @notice The kind a player carries (0 = only the K-7). The game server reads this at spawn.
    function equippedKind(address player) external view returns (uint256) {
        uint256 t = equipped[player];
        return t == 0 || _owner[t] != player ? 0 : kindOf[t];
    }

    /// @notice Called by `game` after every run. A no-op for a player carrying nothing.
    function recordRun(address player, uint32 kills, bool) external {
        if (msg.sender != game) revert NotGame();
        uint256 tokenId = equipped[player];
        if (tokenId == 0 || _owner[tokenId] != player) return;
        Stats storage s = stats[tokenId];
        s.runs += 1;
        s.kills += kills;
        emit RunRecorded(tokenId, s.runs, s.kills);
    }

    function _equip(address holder, uint256 tokenId) internal {
        equipped[holder] = tokenId;
        emit Equipped(holder, tokenId);
    }

    // ── the lineup ──────────────────────────────────────────────────────────────
    function addKind(string calldata kindName, string calldata rarity, uint32 cap, uint96 price)
        external
        onlyOwner
        unlocked
        returns (uint256 kind)
    {
        _kinds.push(Kind({name: kindName, rarity: rarity, cap: cap, minted: 0, price: price, head: address(0), tail: address(0)}));
        kind = _kinds.length;
        emit KindAdded(kind, kindName, rarity, cap, price);
    }

    /// @notice Store a kind's art: the SVG before and after the per-token "NO. 12 · 40 RUNS" line.
    function setArt(uint256 kind, bytes calldata head, bytes calldata tail) external onlyOwner unlocked {
        Kind storage k = _kind(kind);
        k.head = _store(head);
        k.tail = _store(tail);
        emit ArtSet(kind, k.head, k.tail);
    }

    /// @notice Freeze the lineup and the art forever.
    function lock() external onlyOwner unlocked {
        locked = true;
        emit Locked();
    }

    function setPrice(uint256 kind, uint96 price) external onlyOwner {
        _kind(kind).price = price;
        emit PriceSet(kind, price);
    }

    function kinds() external view returns (Kind[] memory) {
        return _kinds;
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

    function withdraw(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(to, amount);
    }

    function _kind(uint256 kind) internal view returns (Kind storage) {
        if (kind == 0 || kind > _kinds.length) revert NoSuchKind();
        return _kinds[kind - 1];
    }

    // ── art storage: data kept as the code of a tiny contract (the SSTORE2 pattern) ──
    function _store(bytes calldata data) internal returns (address ptr) {
        if (data.length == 0 || data.length > 24575) revert BadArt();
        // runtime = 0x00 (STOP, so it can't be called) followed by the data
        bytes memory init = abi.encodePacked(hex"61", uint16(data.length + 1), hex"80600a3d393df300", data);
        assembly {
            ptr := create(0, add(init, 32), mload(init))
        }
        if (ptr == address(0)) revert BadArt();
    }

    function _load(address ptr) internal view returns (bytes memory data) {
        uint256 size = ptr.code.length - 1;
        data = new bytes(size);
        assembly {
            extcodecopy(ptr, add(data, 32), 1, size)
        }
    }

    // ── metadata ────────────────────────────────────────────────────────────────
    /// @notice Fully on-chain: the kind's stored art with this token's number and run count.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        Kind storage k = _kinds[kindOf[tokenId] - 1];
        Stats memory s = stats[tokenId];
        string memory idStr = _toString(tokenId);
        string memory line = string.concat(
            '<text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ',
            idStr, " &#183; ", _toString(s.runs), " RUNS</text>"
        );
        string memory svg = k.head == address(0)
            ? string.concat(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#cfd2dc"/>',
                '<g font-family="sans-serif" fill="#24222c"><text x="38" y="542" font-size="42">', k.name, "</text>", line, "</g></svg>"
            )
            : string.concat(string(_load(k.head)), line, string(_load(k.tail)));
        string memory json = string.concat(
            '{"name":"HAM ', k.name, " #", idStr,
            '","description":"A HAM Power-Up. Carry it into the daily maze for one extra move with a few charges per run.",',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg)), '",',
            '"attributes":[{"trait_type":"Kind","value":"', k.name,
            '"},{"trait_type":"Rarity","value":"', k.rarity,
            '"},{"trait_type":"Runs","value":', _toString(s.runs),
            '},{"trait_type":"Kills","value":', _toString(s.kills), "}]}"
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
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
        if (equipped[from] == tokenId) _equip(from, 0);
        if (equipped[to] == 0) _equip(to, tokenId);
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
