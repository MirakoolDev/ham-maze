// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HamPowerUps
/// @notice HAM's Power-Ups: guns you keep, like the Marker, Pulse, Blinker or Snare. Everyone starts
/// a run with the free K-7 carbine, which is not an NFT.
///
/// Every Power-Up is sold as a sealed pack, and every pack costs the same. The price starts low each
/// day (about $1) and every pack sold that day multiplies it by `growth`, which by default is
/// 10^(1/100): ten times dearer after 100 packs, a hundred times after 200. It drops back at 00:00
/// UTC. There are 10,000 packs in all. You strip (open) a pack to see which gun is inside.
///
/// What a pack holds is drawn like a card from a shuffled deck: the lineup's caps add up to exactly
/// 10,000, so each kind's chance is its share of what is still in the deck, and every pack can always
/// be opened. The draw uses the hash of the block the pack was bought in, which nobody knows while
/// buying, so a buyer cannot pick a good pack and a bot cannot re-roll by choosing when to open.
/// A sealed pack cannot be transferred: once its block hash exists, anyone could read what is inside,
/// and selling only the bad ones would cheat the buyer.
///
/// The lineup is data, not code: the owner adds kinds (name, rarity, cap) and uploads each kind's art
/// and the pack art, then calls `lock()`. Sales open at the lock, after which no kind or art changes.
contract HamPowerUps {
    string public constant name = "HAM Power-Ups";
    string public constant symbol = "HAMPU";
    uint256 public constant MAX_PACKS = 10_000;
    uint256 public constant MAX_PER_BUY = 20;

    struct Kind {
        string name;
        string rarity;
        uint32 cap; // how many of this kind are in the 10,000-pack deck
        uint32 minted; // how many have come out of opened packs
        address head; // art before the per-token line, stored as contract code
        address tail; // art after it
    }

    struct Stats {
        uint32 runs;
        uint32 kills;
    }

    address public owner;
    mapping(address => bool) public isGame; // the game contracts allowed to call recordRun (daily run, later multiplayer)
    bool public locked; // lineup and art frozen for good; sales open

    // the price: basePrice for the day's first pack, times `growth` (1e18 = x1) for every pack after
    uint96 public basePrice = 0.00055 ether; // about $1 at $1,800 ETH
    uint64 public growth = 1_023292992280754130; // 10^(1/100): x10 per 100 packs
    uint256 public priceDay; // the UTC day `_nextPrice` belongs to
    uint256 internal _nextPrice;

    Kind[] internal _kinds; // kind id = index + 1
    address internal _packHead;
    address internal _packTail;
    uint256 public totalSupply; // packs sold
    uint256 public opened;
    mapping(uint256 => uint256) public kindOf; // tokenId => kind id, 0 = still sealed
    mapping(uint256 => uint256) public boughtAt; // tokenId => block number it was bought in
    mapping(uint256 => bytes32) public blockSeal; // block number => its hash, kept before it ages out
    uint256 internal _lastBuyBlock;
    mapping(uint256 => Stats) public stats;
    mapping(address => uint256) public equipped; // wallet => tokenId it carries into runs, 0 = none

    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;
    uint256 private _lock = 1;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    event KindAdded(uint256 indexed kind, string name, string rarity, uint32 cap);
    event ArtSet(uint256 indexed kind, address head, address tail); // kind 0 = the pack
    event Locked();
    event PricingSet(uint96 basePrice, uint64 growth);
    event PackOpened(uint256 indexed tokenId, address indexed holder, uint256 indexed kind);
    event Equipped(address indexed holder, uint256 indexed tokenId);
    event RunRecorded(uint256 indexed tokenId, uint32 runs, uint32 kills);
    event GameSet(address indexed game, bool allowed);
    event OwnerSet(address owner);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOwner();
    error NotGame();
    error IsLocked();
    error NotOpenYet();
    error NoSuchKind();
    error SoldOut();
    error WrongPrice();
    error BadCount();
    error BadCaps();
    error StillSealed();
    error AlreadyOpened();
    error TooSoon();
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

    // ── buying and opening ───────────────────────────────────────────────────────
    /// @notice What the next pack costs. Back to basePrice at 00:00 UTC.
    function priceNow() public view returns (uint256) {
        return priceDay == block.timestamp / 1 days ? _nextPrice : basePrice;
    }

    /// @notice What `count` packs cost together right now (each one dearer than the last), and the
    /// price of the pack after them.
    function quote(uint256 count) public view returns (uint256 cost, uint256 next) {
        next = priceNow();
        for (uint256 i; i < count; ++i) {
            cost += next;
            next = next * growth / 1e18;
        }
    }

    /// @notice Buy `count` sealed packs. Anything paid over is sent back, so a buyer can pay a
    /// little extra in case someone else's packs land first and push the price up.
    function buy(uint256 count) external payable nonReentrant returns (uint256 firstId) {
        if (!locked) revert NotOpenYet();
        if (count == 0 || count > MAX_PER_BUY) revert BadCount();
        if (totalSupply + count > MAX_PACKS) revert SoldOut();
        (uint256 cost, uint256 next) = quote(count);
        if (msg.value < cost) revert WrongPrice();
        priceDay = block.timestamp / 1 days;
        _nextPrice = next;
        _keepSeal();
        _lastBuyBlock = block.number;
        firstId = totalSupply + 1;
        for (uint256 i; i < count; ++i) {
            uint256 tokenId = ++totalSupply;
            boughtAt[tokenId] = block.number;
            _owner[tokenId] = msg.sender;
            emit Transfer(address(0), msg.sender, tokenId);
        }
        _balance[msg.sender] += count;
        if (msg.value > cost) _send(msg.sender, msg.value - cost);
    }

    /// @notice Strip a pack you hold and see which gun is inside. Works from the block after you
    /// bought it. Your first gun is equipped automatically.
    function open(uint256 tokenId) external returns (uint256 kind) {
        if (ownerOf(tokenId) != msg.sender) revert NotAuthorized();
        if (kindOf[tokenId] != 0) revert AlreadyOpened();
        uint256 bought = boughtAt[tokenId];
        if (block.number <= bought) revert TooSoon();
        _keepSeal();
        bytes32 h = blockhash(bought);
        if (h == 0) h = blockSeal[bought];
        // Only if nobody touched this contract for the ~256 blocks after the purchase and the pack was
        // left shut all that time: fall back to the latest block. Rare, and costs the opener waiting.
        if (h == 0) h = blockhash(block.number - 1);
        kind = _draw(uint256(keccak256(abi.encode(h, tokenId))));
        kindOf[tokenId] = kind;
        opened += 1;
        emit PackOpened(tokenId, msg.sender, kind);
        if (equipped[msg.sender] == 0) _equip(msg.sender, tokenId);
    }

    /// @dev Remember the hash of the last block packs were bought in while it can still be read.
    function _keepSeal() internal {
        uint256 b = _lastBuyBlock;
        if (b != 0 && b < block.number && blockSeal[b] == 0) {
            bytes32 h = blockhash(b);
            if (h != 0) blockSeal[b] = h;
        }
    }

    /// @dev Deal one card from what is left of the deck.
    function _draw(uint256 rnd) internal returns (uint256) {
        uint256 r = rnd % (MAX_PACKS - opened);
        for (uint256 i; i < _kinds.length; ++i) {
            Kind storage k = _kinds[i];
            uint256 left = k.cap - k.minted;
            if (r < left) {
                k.minted += 1;
                return i + 1;
            }
            r -= left;
        }
        revert SoldOut(); // unreachable: the caps add up to MAX_PACKS
    }

    /// @notice Choose which of your opened guns you carry into runs.
    function equip(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotAuthorized();
        if (kindOf[tokenId] == 0) revert StillSealed();
        _equip(msg.sender, tokenId);
    }

    /// @notice The kind a player carries (0 = only the K-7). The game server reads this at spawn.
    function equippedKind(address player) external view returns (uint256) {
        uint256 t = equipped[player];
        return t == 0 || _owner[t] != player ? 0 : kindOf[t];
    }

    /// @notice Called by an allowed game after every run. A no-op for a player carrying nothing.
    function recordRun(address player, uint32 kills, bool) external {
        if (!isGame[msg.sender]) revert NotGame();
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
    function addKind(string calldata kindName, string calldata rarity, uint32 cap)
        external
        onlyOwner
        unlocked
        returns (uint256 kind)
    {
        _kinds.push(Kind({name: kindName, rarity: rarity, cap: cap, minted: 0, head: address(0), tail: address(0)}));
        kind = _kinds.length;
        emit KindAdded(kind, kindName, rarity, cap);
    }

    /// @notice Store art: the SVG before and after the per-token line. Kind 0 is the sealed pack.
    function setArt(uint256 kind, bytes calldata head, bytes calldata tail) external onlyOwner unlocked {
        address h = _store(head);
        address t = _store(tail);
        if (kind == 0) {
            (_packHead, _packTail) = (h, t);
        } else {
            Kind storage k = _kind(kind);
            (k.head, k.tail) = (h, t);
        }
        emit ArtSet(kind, h, t);
    }

    /// @notice Freeze the lineup and the art forever, and open sales. The caps must add up to 10,000.
    function lock() external onlyOwner unlocked {
        uint256 sum;
        for (uint256 i; i < _kinds.length; ++i) sum += _kinds[i].cap;
        if (sum != MAX_PACKS) revert BadCaps();
        locked = true;
        emit Locked();
    }

    /// @notice Tune the daily curve: the first pack's price and the per-pack multiplier (1e18 = flat).
    /// Starts over from the new base right away.
    function setPricing(uint96 basePrice_, uint64 growth_) external onlyOwner {
        if (basePrice_ == 0 || growth_ < 1e18) revert WrongPrice();
        (basePrice, growth) = (basePrice_, growth_);
        priceDay = 0;
        emit PricingSet(basePrice_, growth_);
    }

    function kinds() external view returns (Kind[] memory) {
        return _kinds;
    }

    /// @notice Allow or remove a game contract that reports runs. Several can be allowed at once,
    /// so a later mode (multiplayer, tournaments) can count runs on the same guns.
    function setGame(address game_, bool allowed) external onlyOwner {
        if (game_ == address(0)) revert ZeroAddress();
        isGame[game_] = allowed;
        emit GameSet(game_, allowed);
    }

    function transferOwner(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        owner = to;
        emit OwnerSet(to);
    }

    function withdraw(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        _send(to, amount);
        emit Withdrawn(to, amount);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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
    /// @notice Fully on-chain. A sealed pack shows the pack art; an opened one shows its gun with
    /// this token's number and run count.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        string memory idStr = _toString(tokenId);
        string memory open_ =
            '<text x="560" y="76" text-anchor="end" font-size="11" font-weight="500" letter-spacing="2.6" opacity="0.72">NO. ';
        uint256 kind = kindOf[tokenId];
        if (kind == 0) {
            string memory pline = string.concat(open_, idStr, " OF 10,000</text>");
            string memory psvg = _packHead == address(0)
                ? _plain("Sealed pack", pline)
                : string.concat(string(_load(_packHead)), pline, string(_load(_packTail)));
            return _json(
                string.concat("HAM Sealed pack #", idStr),
                "A sealed HAM Power-Up pack. Strip it to see which gun is inside.",
                psvg,
                '{"trait_type":"Kind","value":"Sealed pack"}'
            );
        }
        Kind storage k = _kinds[kind - 1];
        Stats memory s = stats[tokenId];
        string memory line = string.concat(open_, idStr, " &#183; ", _toString(s.runs), " RUNS</text>");
        string memory svg = k.head == address(0)
            ? _plain(k.name, line)
            : string.concat(string(_load(k.head)), line, string(_load(k.tail)));
        return _json(
            string.concat("HAM ", k.name, " #", idStr),
            "A HAM Power-Up. Carry it into the daily maze for one extra move with a few charges per run.",
            svg,
            string.concat(
                '{"trait_type":"Kind","value":"', k.name,
                '"},{"trait_type":"Rarity","value":"', k.rarity,
                '"},{"trait_type":"Runs","value":', _toString(s.runs),
                '},{"trait_type":"Kills","value":', _toString(s.kills), "}"
            )
        );
    }

    function _plain(string memory title, string memory line) private pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><rect width="600" height="600" fill="#cfd2dc"/>',
            '<g font-family="sans-serif" fill="#24222c"><text x="38" y="542" font-size="42">', title, "</text>", line, "</g></svg>"
        );
    }

    function _json(string memory title, string memory desc, string memory svg, string memory attrs)
        private
        pure
        returns (string memory)
    {
        string memory json = string.concat(
            '{"name":"', title, '","description":"', desc,
            '","image":"data:image/svg+xml;base64,', _base64(bytes(svg)),
            '","attributes":[', attrs, "]}"
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
        if (kindOf[tokenId] == 0) revert StillSealed();
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
