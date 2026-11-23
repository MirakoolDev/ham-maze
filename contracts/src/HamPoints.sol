// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title HamPoints
/// @notice HAM Points: an ERC20 that players earn by playing, one point per ranked point a run
/// scores (after power-up boosts and the repeat-run cut). It is a standard ERC20 for wallets,
/// explorers and partner contracts to read, but players can't trade it: points only move to or
/// from a gateway, a contract the owner approves to redeem them (for $PFWA, a partner token, or
/// through a Uniswap v4 hook later). A plain wallet-to-wallet transfer, or a send to a DEX pool
/// that isn't a gateway, reverts.
///
/// Who can do what:
/// - Minters (the HAM game contracts) create points. The game mints only for a run its referee
///   signed, capped per run, and a new referee key takes days to take effect. That is a trust in
///   the game's owner and referee key, not a guarantee: whoever controls the referee key can
///   sign runs. The owner adds and removes minters until `lockMinters`, after which the minter
///   list can never change.
/// - Gateways can receive points from a player who approved them (the usual ERC20
///   approve + transferFrom), and can send points on. They can't take points without approval.
///   A gateway that forwards for anyone would make points tradeable, so the owner should only
///   add redeem contracts, and can freeze the gateway list for good with `lockGateways`.
/// - Any holder can burn their own points.
contract HamPoints {
    string public constant name = "HAM Points";
    string public constant symbol = "HAMP";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;
    address public pendingOwner;
    mapping(address => bool) public isMinter;
    mapping(address => bool) public isGateway;
    bool public mintersLocked;
    bool public gatewaysLocked;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event MinterSet(address indexed minter, bool allowed);
    event MintersLocked();
    event GatewaysLocked();
    event GatewaySet(address indexed gateway, bool allowed);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    error NotOwner();
    error NotPendingOwner();
    error NotMinter();
    error Locked();
    error NotTransferable();
    error InsufficientBalance();
    error InsufficientAllowance();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    // ── ERC20 ───────────────────────────────────────────────────────────────────
    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance();
            allowance[from][msg.sender] = allowed - amount;
        }
        _move(from, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Whether points can move from `from` to `to`: only when one side is a gateway.
    function canTransfer(address from, address to) public view returns (bool) {
        return isGateway[from] || isGateway[to];
    }

    // ── Mint and burn ───────────────────────────────────────────────────────────
    function mint(address to, uint256 amount) external {
        if (!isMinter[msg.sender]) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        totalSupply += amount;
        unchecked {
            balanceOf[to] += amount; // can't overflow: bounded by totalSupply
        }
        emit Transfer(address(0), to, amount);
    }

    function burn(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = bal - amount;
            totalSupply -= amount;
        }
        emit Transfer(msg.sender, address(0), amount);
    }

    // ── Admin ───────────────────────────────────────────────────────────────────
    function setMinter(address minter, bool allowed) external onlyOwner {
        if (mintersLocked) revert Locked();
        if (minter == address(0)) revert ZeroAddress();
        isMinter[minter] = allowed;
        emit MinterSet(minter, allowed);
    }

    /// @notice Freezes the minter list forever: no game can be added or removed after this.
    function lockMinters() external onlyOwner {
        mintersLocked = true;
        emit MintersLocked();
    }

    /// @notice A contract players may send points to (to redeem them), and that may send them on.
    function setGateway(address gateway, bool allowed) external onlyOwner {
        if (gatewaysLocked) revert Locked();
        if (gateway == address(0)) revert ZeroAddress();
        isGateway[gateway] = allowed;
        emit GatewaySet(gateway, allowed);
    }

    /// @notice Freezes the gateway list forever: no redeem contract can be added or removed after this.
    function lockGateways() external onlyOwner {
        gatewaysLocked = true;
        emit GatewaysLocked();
    }

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

    // ── Internal ────────────────────────────────────────────────────────────────
    function _move(address from, address to, uint256 amount) internal {
        if (to == address(0)) revert ZeroAddress();
        if (!canTransfer(from, to)) revert NotTransferable();
        uint256 bal = balanceOf[from];
        if (bal < amount) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - amount;
            balanceOf[to] += amount; // can't overflow: bounded by totalSupply
        }
        emit Transfer(from, to, amount);
    }
}
