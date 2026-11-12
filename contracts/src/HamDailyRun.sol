// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

/// @title HamDailyRun
/// @notice The pot for HAM (Home's a Maze), a daily first-person maze run on Robinhood Chain.
///
/// Everyone runs the same maze each UTC day. A run costs `entryFee` in ETH, and the whole fee goes
/// into that day's pot. Holders of `holderToken` (an ERC-721 or ERC-20; any balance counts) also
/// get one free run a day.
///
/// The game client cannot be trusted with times, so a run only counts once the referee (the
/// game's replay server) has replayed its input log and signed the finish time. The player
/// submits that signature here. Each paid or free run is one numbered attempt and can carry one
/// signed time. A player's best time is what ranks.
///
/// Days run 00:00 to 00:00 UTC. Runs from a day can still be submitted for SETTLE_DELAY after it
/// ends, then anyone can settle it:
///   1st 50%, 2nd 20%, 3rd 10%  to the top three times, claimable for CLAIM_WINDOW
///   10%                        treasury, which first pays the holder bonus (+10% of a holder's
///                              prize) and referral rewards (5% of a referred winner's prize)
///   10% + any unawarded place  rolls into the current day's pot
/// Prizes not claimed in time can be swept back into the current pot by anyone.
///
/// The owner also stores the game settings (maze size, cell size, sentries...). A change takes
/// effect from the next UTC day so nobody's maze changes mid-day, unless no one has entered today.
contract HamDailyRun {
    // ── Constants ───────────────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    uint256 public constant FIRST_BPS = 5000;
    uint256 public constant SECOND_BPS = 2000;
    uint256 public constant THIRD_BPS = 1000;
    uint256 public constant TREASURY_BPS = 1000; // the remaining 1000 rolls over
    uint256 public constant HOLDER_BONUS_BPS = 1000; // +10% of a holder's prize, from the treasury share
    uint256 public constant REFERRAL_BPS = 500; // 5% of a referred winner's prize, from the treasury share
    uint256 public constant SETTLE_DELAY = 15 minutes;
    uint256 public constant CLAIM_WINDOW = 7 days;
    uint256 public constant MAX_ENTRY_FEE = 1 ether;
    bytes32 public constant RUN_TAG = keccak256("HAM_RUN_V1");

    // ── Game settings, read by the game and the referee ────────────────────────
    struct GameConfig {
        uint8 mazeSize; // cells per side, 8..32 (the monolith sits on the centre cell)
        uint8 cellSize; // metres per cell, 4..14
        uint8 sentries; // 0..64
        uint8 sentryHealth; // 10..250
        uint8 sentryDamage; // per bolt, 1..100
        uint8 playerHealth; // 50..250
        uint8 magSize; // rounds per magazine, 5..100
        uint8 loops; // extra openings punched into the maze, 0..100 (more loops = more routes)
    }

    struct Day {
        uint128 pot;
        uint128 unclaimed; // prizes awarded and not yet claimed
        uint64 settledAt; // 0 = not settled
        uint32 entries;
        address[3] top;
        uint32[3] topTime; // milliseconds
    }

    // ── State ───────────────────────────────────────────────────────────────────
    address public owner;
    address public pendingOwner;
    address public referee;
    address public treasury;
    address public holderToken;
    uint256 public entryFee;
    bool public paused;

    GameConfig internal _config;
    GameConfig internal _nextConfig;
    uint256 public nextConfigDay; // 0 = nothing scheduled

    mapping(uint256 => Day) internal _days;
    mapping(uint256 => mapping(address => uint32)) public attempts; // runs bought (paid + free) per day
    mapping(uint256 => mapping(address => mapping(uint32 => bool))) public attemptUsed;
    mapping(uint256 => mapping(address => bool)) public freeRunUsed;
    mapping(uint256 => mapping(address => uint32)) public bestTime; // ms, 0 = no finished run
    mapping(uint256 => mapping(address => uint256)) public prizeOf; // claimable prize
    mapping(address => bool) public joined;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public referralOwed;
    uint256 public treasuryOwed;

    uint256 private _lock = 1;

    // ── Events ──────────────────────────────────────────────────────────────────
    event Entered(uint256 indexed day, address indexed player, uint32 attempt, bool free, uint256 paid);
    event RunSubmitted(uint256 indexed day, address indexed player, uint32 attempt, uint32 timeMs, bool best);
    event PotSeeded(uint256 indexed day, address indexed from, uint256 amount);
    event DaySettled(uint256 indexed day, address[3] top, uint256[3] prize, uint256 treasury, uint256 rollover);
    event PrizeClaimed(uint256 indexed day, address indexed player, uint256 amount);
    event UnclaimedSwept(uint256 indexed day, uint256 amount);
    event ReferrerSet(address indexed player, address indexed referrer);
    event ReferralReward(uint256 indexed day, address indexed referrer, address indexed player, uint256 amount);
    event ReferralClaimed(address indexed referrer, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event ConfigSet(uint256 indexed effectiveDay, GameConfig config);
    event EntryFeeSet(uint256 fee);
    event RefereeSet(address referee);
    event TreasurySet(address treasury);
    event HolderTokenSet(address token);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);

    // ── Errors ──────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error Paused();
    error Reentrancy();
    error WrongFee();
    error NotHolder();
    error FreeRunUsed();
    error DayClosed();
    error BadAttempt();
    error AttemptUsed();
    error BadTime();
    error BadSignature();
    error TooEarly();
    error AlreadySettled();
    error NotSettled();
    error ClaimClosed();
    error ClaimOpen();
    error NothingToClaim();
    error BadConfig();
    error DayStarted();
    error ZeroAddress();
    error FeeTooHigh();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(address owner_, address referee_, address treasury_, uint256 entryFee_, GameConfig memory config_) {
        if (owner_ == address(0) || referee_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (entryFee_ > MAX_ENTRY_FEE) revert FeeTooHigh();
        _checkConfig(config_);
        owner = owner_;
        referee = referee_;
        treasury = treasury_;
        entryFee = entryFee_;
        _config = config_;
        emit OwnershipTransferred(address(0), owner_);
        emit RefereeSet(referee_);
        emit TreasurySet(treasury_);
        emit EntryFeeSet(entryFee_);
        emit ConfigSet(currentDay(), config_);
    }

    // ── Views ───────────────────────────────────────────────────────────────────
    function currentDay() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    /// @notice The settings for a day. Days before a scheduled change get the current settings.
    function configFor(uint256 day) public view returns (GameConfig memory) {
        if (nextConfigDay != 0 && day >= nextConfigDay) return _nextConfig;
        return _config;
    }

    function currentConfig() external view returns (GameConfig memory) {
        return configFor(currentDay());
    }

    function dayInfo(uint256 day)
        external
        view
        returns (uint256 pot, uint256 unclaimed, uint256 settledAt, uint256 entries, address[3] memory top, uint32[3] memory topTime)
    {
        Day storage d = _days[day];
        return (d.pot, d.unclaimed, d.settledAt, d.entries, d.top, d.topTime);
    }

    function isHolder(address player) public view returns (bool) {
        address token = holderToken;
        if (token == address(0)) return false;
        try IBalanceOf(token).balanceOf(player) returns (uint256 bal) {
            return bal > 0;
        } catch {
            return false;
        }
    }

    /// @notice The message the referee signs for a run (then signed as an Ethereum signed message).
    function runDigest(uint256 day, address player, uint32 attempt, uint32 timeMs) public view returns (bytes32) {
        return keccak256(abi.encode(RUN_TAG, block.chainid, address(this), day, player, attempt, timeMs));
    }

    // ── Playing ─────────────────────────────────────────────────────────────────
    /// @notice Buy one run of today's maze. `referrer` is recorded on your first entry only.
    function enter(address referrer) external payable whenNotPaused returns (uint32 attempt) {
        if (msg.value != entryFee) revert WrongFee();
        uint256 day = currentDay();
        _join(msg.sender, referrer);
        _days[day].pot += uint128(msg.value);
        attempt = _newAttempt(day, msg.sender);
        emit Entered(day, msg.sender, attempt, false, msg.value);
    }

    /// @notice A holder's free run, once per day.
    function enterFree(address referrer) external whenNotPaused returns (uint32 attempt) {
        uint256 day = currentDay();
        if (!isHolder(msg.sender)) revert NotHolder();
        if (freeRunUsed[day][msg.sender]) revert FreeRunUsed();
        freeRunUsed[day][msg.sender] = true;
        _join(msg.sender, referrer);
        attempt = _newAttempt(day, msg.sender);
        emit Entered(day, msg.sender, attempt, true, 0);
    }

    /// @notice Record a finished run with the referee's signature over `runDigest`.
    /// Runs from today, or from yesterday until SETTLE_DELAY after midnight, are accepted.
    function submitRun(uint256 day, uint32 attempt, uint32 timeMs, bytes calldata signature) external {
        uint256 today = currentDay();
        if (day != today && !(day + 1 == today && block.timestamp < today * 1 days + SETTLE_DELAY)) revert DayClosed();
        if (_days[day].settledAt != 0) revert DayClosed();
        if (attempt >= attempts[day][msg.sender]) revert BadAttempt();
        if (attemptUsed[day][msg.sender][attempt]) revert AttemptUsed();
        if (timeMs == 0) revert BadTime();
        if (_recover(_ethSigned(runDigest(day, msg.sender, attempt, timeMs)), signature) != referee) revert BadSignature();
        attemptUsed[day][msg.sender][attempt] = true;

        uint32 prev = bestTime[day][msg.sender];
        bool best = prev == 0 || timeMs < prev;
        if (best) {
            bestTime[day][msg.sender] = timeMs;
            _rank(_days[day], msg.sender, timeMs);
        }
        emit RunSubmitted(day, msg.sender, attempt, timeMs, best);
    }

    /// @notice Add ETH to a day's pot (today or later), e.g. a sponsor top-up.
    function fundPot(uint256 day) external payable {
        if (day < currentDay()) revert DayClosed();
        _days[day].pot += uint128(msg.value);
        emit PotSeeded(day, msg.sender, msg.value);
    }

    // ── Settling and claiming ──────────────────────────────────────────────────
    function settle(uint256 day) external {
        if (block.timestamp < (day + 1) * 1 days + SETTLE_DELAY) revert TooEarly();
        Day storage d = _days[day];
        if (d.settledAt != 0) revert AlreadySettled();
        d.settledAt = uint64(block.timestamp);

        uint256 pot = d.pot;
        uint256 treasuryShare = pot * TREASURY_BPS / BPS;
        uint256[3] memory share = [pot * FIRST_BPS / BPS, pot * SECOND_BPS / BPS, pot * THIRD_BPS / BPS];
        uint256[3] memory prize;
        uint256 rollover = pot - treasuryShare;
        uint256 unclaimed;

        for (uint256 i; i < 3; ++i) {
            address p = d.top[i];
            if (p == address(0)) continue;
            rollover -= share[i];
            uint256 amount = share[i];
            if (isHolder(p)) {
                uint256 bonus = _min(amount * HOLDER_BONUS_BPS / BPS, treasuryShare);
                treasuryShare -= bonus;
                amount += bonus;
            }
            address ref = referrerOf[p];
            if (ref != address(0)) {
                uint256 reward = _min(amount * REFERRAL_BPS / BPS, treasuryShare);
                if (reward > 0) {
                    treasuryShare -= reward;
                    referralOwed[ref] += reward;
                    emit ReferralReward(day, ref, p, reward);
                }
            }
            prize[i] = amount;
            prizeOf[day][p] = amount;
            unclaimed += amount;
        }

        d.unclaimed = uint128(unclaimed);
        treasuryOwed += treasuryShare;
        uint256 today = currentDay();
        _days[today].pot += uint128(rollover);
        emit DaySettled(day, d.top, prize, treasuryShare, rollover);
    }

    function claim(uint256 day) external nonReentrant {
        Day storage d = _days[day];
        if (d.settledAt == 0) revert NotSettled();
        if (block.timestamp > d.settledAt + CLAIM_WINDOW) revert ClaimClosed();
        uint256 amount = prizeOf[day][msg.sender];
        if (amount == 0) revert NothingToClaim();
        prizeOf[day][msg.sender] = 0;
        d.unclaimed -= uint128(amount);
        _send(msg.sender, amount);
        emit PrizeClaimed(day, msg.sender, amount);
    }

    /// @notice After the claim window, move a day's unclaimed prizes into today's pot.
    function sweep(uint256 day) external {
        Day storage d = _days[day];
        if (d.settledAt == 0) revert NotSettled();
        if (block.timestamp <= d.settledAt + CLAIM_WINDOW) revert ClaimOpen();
        uint256 amount = d.unclaimed;
        if (amount == 0) revert NothingToClaim();
        d.unclaimed = 0;
        _days[currentDay()].pot += uint128(amount);
        emit UnclaimedSwept(day, amount);
    }

    function claimReferral() external nonReentrant {
        uint256 amount = referralOwed[msg.sender];
        if (amount == 0) revert NothingToClaim();
        referralOwed[msg.sender] = 0;
        _send(msg.sender, amount);
        emit ReferralClaimed(msg.sender, amount);
    }

    /// @notice Pays the treasury what it has earned. Anyone can call it; the ETH only goes to `treasury`.
    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryOwed;
        if (amount == 0) revert NothingToClaim();
        treasuryOwed = 0;
        _send(treasury, amount);
        emit TreasuryWithdrawn(treasury, amount);
    }

    // ── Admin ───────────────────────────────────────────────────────────────────
    /// @notice Change the game settings. With `immediate`, they apply today, which is only allowed
    /// before anyone has entered today; otherwise they apply from the next UTC day.
    function setConfig(GameConfig calldata config_, bool immediate) external onlyOwner {
        _checkConfig(config_);
        uint256 today = currentDay();
        _rollConfig(today);
        if (immediate) {
            if (_days[today].entries != 0) revert DayStarted();
            _config = config_;
            nextConfigDay = 0;
            emit ConfigSet(today, config_);
        } else {
            _nextConfig = config_;
            nextConfigDay = today + 1;
            emit ConfigSet(today + 1, config_);
        }
    }

    function setEntryFee(uint256 fee) external onlyOwner {
        if (fee > MAX_ENTRY_FEE) revert FeeTooHigh();
        entryFee = fee;
        emit EntryFeeSet(fee);
    }

    function setReferee(address referee_) external onlyOwner {
        if (referee_ == address(0)) revert ZeroAddress();
        referee = referee_;
        emit RefereeSet(referee_);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice The NFT (or token) whose holders get the bonus and a free daily run. Zero turns it off.
    function setHolderToken(address token) external onlyOwner {
        holderToken = token;
        emit HolderTokenSet(token);
    }

    /// @notice Pausing stops new entries only; submitting, settling and claiming keep working.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
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

    // ── Internals ───────────────────────────────────────────────────────────────
    function _join(address player, address referrer) internal {
        if (joined[player]) return;
        joined[player] = true;
        // set once, on the first entry; never yourself, never someone you referred
        if (referrer != address(0) && referrer != player && referrerOf[referrer] != player) {
            referrerOf[player] = referrer;
            emit ReferrerSet(player, referrer);
        }
    }

    function _newAttempt(uint256 day, address player) internal returns (uint32 attempt) {
        attempt = attempts[day][player];
        attempts[day][player] = attempt + 1;
        _days[day].entries += 1;
    }

    /// @dev Keeps the top three sorted by time. Only called when `player` improved their best,
    /// so taking them out and reinserting them is safe. Ties keep the earlier time ahead.
    function _rank(Day storage d, address player, uint32 timeMs) internal {
        for (uint256 i; i < 3; ++i) {
            if (d.top[i] == player) {
                for (uint256 j = i; j < 2; ++j) {
                    d.top[j] = d.top[j + 1];
                    d.topTime[j] = d.topTime[j + 1];
                }
                d.top[2] = address(0);
                d.topTime[2] = 0;
                break;
            }
        }
        for (uint256 i; i < 3; ++i) {
            if (d.top[i] == address(0) || timeMs < d.topTime[i]) {
                for (uint256 j = 2; j > i; --j) {
                    d.top[j] = d.top[j - 1];
                    d.topTime[j] = d.topTime[j - 1];
                }
                d.top[i] = player;
                d.topTime[i] = timeMs;
                return;
            }
        }
    }

    function _rollConfig(uint256 today) internal {
        if (nextConfigDay != 0 && today >= nextConfigDay) {
            _config = _nextConfig;
            nextConfigDay = 0;
        }
    }

    function _checkConfig(GameConfig memory c) internal pure {
        if (
            c.mazeSize < 8 || c.mazeSize > 32 || c.cellSize < 4 || c.cellSize > 14 || c.sentries > 64
                || c.sentryHealth < 10 || c.sentryHealth > 250 || c.sentryDamage < 1 || c.sentryDamage > 100
                || c.playerHealth < 50 || c.playerHealth > 250 || c.magSize < 5 || c.magSize > 100 || c.loops > 100
        ) revert BadConfig();
    }

    function _ethSigned(bytes32 h) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
    }

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        // reject malleable signatures (upper-half s), as OpenZeppelin's ECDSA does
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(h, v, r, s);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}
