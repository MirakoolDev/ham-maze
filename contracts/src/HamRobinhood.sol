// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IBalanceOf {
    function balanceOf(address account) external view returns (uint256);
}

interface IHamPowerUps {
    function recordRun(address player, uint32 kills, bool completed) external;
}

interface IHamPoints {
    function mint(address to, uint256 amount) external;
}

interface IHamScoreArt {
    function render(uint256 tokenId, uint256 day, uint32 points, uint32 timeMs, uint32 kills, bool completed, bool isSealed)
        external
        pure
        returns (string memory);
}

/// @title HamRobinhood
/// @notice HAM (Home's a Maze) redesigned for Robinhood Chain around two changes from
/// HamDailyRun: one signature per run instead of two, and a run's score is a tradeable NFT
/// rather than a claim tied to the player's address.
///
/// Entering and submitting are merged into `playRun`: you play first, then call it once with
/// the referee's signature, paying the entry fee in the same transaction as the result. If you
/// lose, you've spent nothing on chain yet; retrying costs another entry fee. Every played run
/// mints a HamScore NFT recording that result. If the run ranks top 3 for the day, whoever holds
/// that NFT when the prize is claimed gets paid, not necessarily whoever played it, so a score
/// can be sold before the day settles.
///
/// Claiming is two steps on purpose. `claimIntent(tokenId)` freezes the NFT (blocks transfer)
/// and starts CLAIM_DELAY; `claimFinalize(tokenId)` pays out after the delay. This closes the
/// failure mode found in a 2023 audit of the Wenwin lottery, where a ticket holder could list a
/// winning ticket for sale and front-run the buyer's purchase with their own claim, collecting
/// both the sale price and the prize. Here, calling claimIntent freezes the token immediately,
/// so a pending sale either lands first (the buyer now owns it and only the buyer can claim) or
/// reverts cleanly (the token is frozen, the transfer fails, the buyer's money never leaves their
/// wallet) - there is no path to double-dip.
contract HamRobinhood {
    // ── Constants ───────────────────────────────────────────────────────────────
    uint256 public constant BPS = 10_000;
    uint256 public constant FIRST_BPS = 4000;
    uint256 public constant SECOND_BPS = 2000;
    uint256 public constant THIRD_BPS = 1000;
    uint256 public constant BACKERS_BPS = 1000; // campaign backers are paid first, never carved into, until backersEndDay; then it rolls over
    uint256 public constant TREASURY_BPS = 1000; // the $PFWA buyback; holder bonus and referrals come out of this. The remaining 1000 rolls over
    uint256 public constant HOLDER_BONUS_BPS = 1000;
    uint256 public constant REFERRAL_BPS = 500;
    /// Repeat runs: every run a wallet plays after its first that day keeps 8% fewer points,
    /// never below 60%. The maze is the same all day, so a later run already knows the way.
    uint256 public constant REPEAT_STEP_BPS = 800;
    uint256 public constant REPEAT_FLOOR_BPS = 6000;
    uint256 public constant CREW_SIZE = 3; // referred players who played today, to unlock the crew bonus
    uint256 public constant CREW_REFERRAL_BPS = 1000; // replaces REFERRAL_BPS once CREW_SIZE is met
    uint256 public constant SETTLE_DELAY = 15 minutes;
    uint256 public constant CLAIM_DELAY = 10 minutes; // claimIntent -> claimFinalize
    uint256 public constant CLAIM_WINDOW = 7 days; // from claimIntent, not from settle
    uint256 public constant MAX_ENTRY_FEE = 1 ether;
    bytes32 public constant RUN_TAG = keccak256("HAM_ROBINHOOD_V1");
    uint256 public constant MAX_BOOSTERS = 4;
    uint256 public constant MAX_BOOST_BPS = 5000;

    string public constant name = "HAM Score";
    string public constant symbol = "HAMSCORE";

    struct GameConfig {
        uint8 mazeSize;
        uint8 cellSize;
        uint8 sentries;
        uint8 sentryHealth;
        uint8 sentryDamage;
        uint8 playerHealth;
        uint8 magSize;
        uint8 loops;
    }

    struct Day {
        uint128 pot;
        uint128 unclaimed;
        uint64 settledAt; // 0 = not settled
        uint32 entries;
        uint256[3] topToken; // 0 = no entrant for that place
        uint32[3] topPoints;
        uint32[3] topTime;
    }

    /// @notice A played run, minted as an NFT. `player` is who played it, fixed forever for
    /// display; it is never who gets paid once the NFT trades hands.
    struct ScoreRecord {
        uint64 day;
        address player;
        uint32 attempt;
        uint32 points; // points as ranked: the referee's points, boosted, then the repeat-run share
        uint32 timeMs;
        uint32 kills;
        bool completed; // reached the monolith, vs. a partial run that still scores on death
    }

    struct Booster {
        address token;
        uint96 minBalance;
        uint16 bps;
    }

    /// @notice What the referee signs off on for one run. Bundled into a struct so `playRun`
    /// doesn't carry each field as its own stack slot (Solidity's "stack too deep" otherwise).
    struct RunResult {
        uint32 points;
        uint32 timeMs;
        uint32 kills;
        bool completed;
    }

    // ── State ───────────────────────────────────────────────────────────────────
    address public owner;
    address public pendingOwner;
    address public referee;
    address public treasury; // may route to a buyback vault for an existing token; this contract mints none
    address public backers; // where the backers' 10% goes (a payout splitter for the campaign); starts as the treasury
    address public holderToken;
    address public powerUp; // optional: HamPowerUps, notified after each run
    address public hamPoints; // optional: HamPoints, which mints one HAM Point per ranked point
    address public scoreArt; // optional: HamScoreArt, which draws each Score from its run
    bool public scoreArtLocked; // once set, the renderer can never be swapped
    uint256 public entryFee;
    bool public paused;

    GameConfig internal _config;
    GameConfig internal _nextConfig;
    uint256 public nextConfigDay;

    mapping(uint256 => Day) internal _days;
    mapping(uint256 => mapping(address => uint32)) public attempts;
    mapping(uint256 => mapping(address => bool)) public freeRunUsed;
    Booster[] internal _boosters;

    // prizes are owed to a tokenId, paid to whoever owns it at claimFinalize time
    mapping(uint256 => uint256) public prizeOf; // tokenId => claimable amount
    mapping(uint256 => uint256) public claimIntentAt; // tokenId => timestamp, 0 = none
    mapping(uint256 => bool) public claimed;

    mapping(address => bool) public joined;
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public referralOwed;
    uint256 public treasuryOwed;
    uint256 public backersOwed;
    // the first day whose pot no longer pays backers (the FundingWorks stream's end); from then on their
    // 10% stays in the pot and rolls over. 0 = not set yet, so backers are paid. Once set it can only move later.
    uint256 public backersEndDay;

    // crew bonus: a referrer whose referred players all play the same day unlocks a bigger cut
    mapping(uint256 => mapping(address => uint32)) public crewSize; // day => referrer => distinct referred players who played
    mapping(uint256 => mapping(address => bool)) internal _crewCounted; // day => player => already counted for their referrer

    // score NFT storage
    uint256 public totalSupply;
    mapping(uint256 => ScoreRecord) public scores;
    mapping(uint256 => address) private _owner;
    mapping(address => uint256) private _balance;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operator;

    uint256 private _lock = 1;

    // ── Events ──────────────────────────────────────────────────────────────────
    event RunPlayed(uint256 indexed day, address indexed player, uint32 attempt, uint256 tokenId, uint32 points, uint32 boosted, uint32 timeMs, bool paid);
    event CrewBonusUnlocked(uint256 indexed day, address indexed referrer, uint32 crewSize);
    event PowerUpSet(address powerUp);
    event HamPointsSet(address hamPoints);
    event ScoreArtSet(address scoreArt);
    event ScoreArtLocked();
    event BoostersSet(Booster[] boosters);
    event PotSeeded(uint256 indexed day, address indexed from, uint256 amount);
    event DaySettled(uint256 indexed day, uint256[3] topToken, uint256[3] prize, uint256 treasury, uint256 rollover);
    event ClaimIntent(uint256 indexed tokenId, address indexed holder, uint256 readyAt);
    event PrizeClaimed(uint256 indexed tokenId, address indexed holder, uint256 amount);
    event UnclaimedSwept(uint256 indexed day, uint256 amount);
    event ReferrerSet(address indexed player, address indexed referrer);
    event ReferralReward(uint256 indexed day, address indexed referrer, address indexed player, uint256 amount);
    event ReferralClaimed(address indexed referrer, uint256 amount);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event ConfigSet(uint256 indexed effectiveDay, GameConfig config);
    event EntryFeeSet(uint256 fee);
    event RefereeSet(address referee);
    event TreasurySet(address treasury);
    event BackersSet(address backers);
    event BackersEndSet(uint256 day);
    event BackersPaid(uint256 indexed day, uint256 amount);
    event HolderTokenSet(address token);
    event PausedSet(bool paused);
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    // ── Errors ──────────────────────────────────────────────────────────────────
    error NotOwner();
    error NotPendingOwner();
    error Paused();
    error Reentrancy();
    error WrongFee();
    error DayClosed();
    error BadAttempt();
    error BadTime();
    error BadSignature();
    error TooEarly();
    error AlreadySettled();
    error NotSettled();
    error NotRanked();
    error ClaimClosed();
    error ClaimOpen();
    error ClaimNotIntended();
    error AlreadyClaimed();
    error NothingToClaim();
    error BadConfig();
    error DayStarted();
    error ZeroAddress();
    error BadBackersEnd();
    error FeeTooHigh();
    error TransferFailed();
    error BadBooster();
    error NotTokenOwner();
    error NotAuthorized();
    error NoSuchToken();
    error TokenFrozen();
    error ArtLocked();
    error NotERC721Receiver();

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
        backers = treasury_;
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
        returns (
            uint256 pot,
            uint256 unclaimed,
            uint256 settledAt,
            uint256 entryCount,
            uint256[3] memory topToken,
            uint32[3] memory topPoints,
            uint32[3] memory topTime
        )
    {
        Day storage d = _days[day];
        return (d.pot, d.unclaimed, d.settledAt, d.entries, d.topToken, d.topPoints, d.topTime);
    }

    function boosters() external view returns (Booster[] memory) {
        return _boosters;
    }

    function boostOf(address player) public view returns (uint256 bps) {
        for (uint256 i; i < _boosters.length; ++i) {
            Booster memory b = _boosters[i];
            try IBalanceOf(b.token).balanceOf(player) returns (uint256 bal) {
                if (bal >= b.minBalance && bal > 0) bps += b.bps;
            } catch {}
        }
        if (bps > MAX_BOOST_BPS) bps = MAX_BOOST_BPS;
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

    function isFrozen(uint256 tokenId) public view returns (bool) {
        return claimIntentAt[tokenId] != 0;
    }

    function runDigest(uint256 day, address player, uint32 attempt, uint32 points, uint32 timeMs, uint32 kills, bool completed)
        public
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(RUN_TAG, block.chainid, address(this), day, player, attempt, points, timeMs, kills, completed));
    }

    // ── Playing: one signed call pays and records the result ──────────────────────
    /// @notice Play today's maze, then call this once with the referee's signature over the
    /// result. Pays `entryFee` unless you hold `holderToken` and haven't used today's free run.
    /// Mints a HamScore NFT for the run either way, win or lose: `r.completed` marks whether the
    /// monolith was reached, but a partial run with `r.points > 0` still scores and still ranks.
    /// `referrer` is recorded on your first call ever. The result fields are bundled into `r`
    /// instead of being separate parameters, to keep this function's stack footprint small.
    function playRun(RunResult calldata r, bytes calldata signature, address referrer)
        external
        payable
        whenNotPaused
        returns (uint256 tokenId)
    {
        uint256 day = currentDay();
        if (_days[day].settledAt != 0) revert DayClosed();
        if (r.timeMs == 0 || r.points == 0) revert BadTime();

        uint32 attempt = attempts[day][msg.sender];
        _verifySignature(day, attempt, r, signature);
        attempts[day][msg.sender] = attempt + 1;
        _days[day].entries += 1;
        _join(msg.sender, referrer);
        _countCrew(day, msg.sender);

        bool paid = _takePayment(day);
        uint32 boosted = _rankedPoints(r.points, attempt);
        tokenId = _mintScore(day, msg.sender, attempt, boosted, r);
        _rank(_days[day], tokenId, boosted, r.timeMs);
        _notifyRun(msg.sender, r.kills, r.completed, boosted);

        emit RunPlayed(day, msg.sender, attempt, tokenId, r.points, boosted, r.timeMs, paid);
    }

    /// @dev If this player was referred and hasn't been counted today, bump their referrer's
    /// crew size. Crosses CREW_SIZE at most once per referrer per day; the event is informational.
    function _countCrew(uint256 day, address player) internal {
        address ref = referrerOf[player];
        if (ref == address(0) || _crewCounted[day][player]) return;
        _crewCounted[day][player] = true;
        uint32 size = crewSize[day][ref] + 1;
        crewSize[day][ref] = size;
        if (size == CREW_SIZE) emit CrewBonusUnlocked(day, ref, size);
    }

    /// @dev Tells the power-up NFT about the run and mints its HAM Points. Best-effort: a missing
    /// or reverting contract never blocks a run.
    function _notifyRun(address player, uint32 kills, bool completed, uint32 ranked) internal {
        address p = powerUp;
        if (p != address(0)) try IHamPowerUps(p).recordRun(player, kills, completed) {} catch {}
        p = hamPoints;
        if (p != address(0)) try IHamPoints(p).mint(player, uint256(ranked) * 1e18) {} catch {}
    }

    function _verifySignature(uint256 day, uint32 attempt, RunResult calldata r, bytes calldata signature) internal view {
        bytes32 digest = runDigest(day, msg.sender, attempt, r.points, r.timeMs, r.kills, r.completed);
        if (_recover(_ethSigned(digest), signature) != referee) revert BadSignature();
    }

    /// @dev Returns whether this run was paid (false for a holder's free run).
    function _takePayment(uint256 day) internal returns (bool paid) {
        bool free = isHolder(msg.sender) && !freeRunUsed[day][msg.sender];
        if (free) {
            if (msg.value != 0) revert WrongFee();
            freeRunUsed[day][msg.sender] = true;
            return false;
        }
        if (msg.value != entryFee) revert WrongFee();
        _days[day].pot += uint128(msg.value);
        return true;
    }

    /// @notice The share of its points a run keeps, in bps, by the wallet's attempt that day
    /// (0 = its first run): 10000, 9200, 8400, 7600, 6800, then 6000 for every run after.
    function attemptShare(uint32 attempt) public pure returns (uint256) {
        uint256 cut = uint256(attempt) * REPEAT_STEP_BPS;
        return cut >= BPS - REPEAT_FLOOR_BPS ? REPEAT_FLOOR_BPS : BPS - cut;
    }

    /// The points a run ranks with: the holder/booster boost first, then the repeat-run share.
    function _rankedPoints(uint32 points, uint32 attempt) internal view returns (uint32 ranked) {
        uint256 b = uint256(points) * (BPS + boostOf(msg.sender)) * attemptShare(attempt) / (BPS * BPS);
        ranked = b > type(uint32).max ? type(uint32).max : uint32(b);
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
        uint256 backersShare = backersEndDay != 0 && day >= backersEndDay ? 0 : pot * BACKERS_BPS / BPS;
        uint256[3] memory share = [pot * FIRST_BPS / BPS, pot * SECOND_BPS / BPS, pot * THIRD_BPS / BPS];
        uint256[3] memory prize;
        uint256 rollover = pot - treasuryShare - backersShare;
        if (backersShare != 0) {
            backersOwed += backersShare;
            emit BackersPaid(day, backersShare);
        }
        uint256 unclaimed;

        for (uint256 i; i < 3; ++i) {
            uint256 tokenId = d.topToken[i];
            if (tokenId == 0) continue;
            rollover -= share[i];
            uint256 amount;
            (amount, treasuryShare) = _settlePlace(day, tokenId, share[i], treasuryShare);
            prize[i] = amount;
            prizeOf[tokenId] = amount;
            unclaimed += amount;
        }

        d.unclaimed = uint128(unclaimed);
        treasuryOwed += treasuryShare;
        uint256 today = currentDay();
        _days[today].pot += uint128(rollover);
        emit DaySettled(day, d.topToken, prize, treasuryShare, rollover);
    }

    /// @dev One top-3 place's payout: holder bonus and referral reward (crew-boosted if the
    /// referrer's crew reached CREW_SIZE that day), both carved out of the treasury share.
    function _settlePlace(uint256 day, uint256 tokenId, uint256 baseAmount, uint256 treasuryShare)
        internal
        returns (uint256 amount, uint256 remainingTreasury)
    {
        amount = baseAmount;
        remainingTreasury = treasuryShare;
        address player = scores[tokenId].player; // boosts and referral follow who played it, not who holds it
        if (isHolder(player)) {
            uint256 bonus = _min(amount * HOLDER_BONUS_BPS / BPS, remainingTreasury);
            remainingTreasury -= bonus;
            amount += bonus;
        }
        address ref = referrerOf[player];
        if (ref != address(0)) {
            uint256 bps = crewSize[day][ref] >= CREW_SIZE ? CREW_REFERRAL_BPS : REFERRAL_BPS;
            uint256 reward = _min(amount * bps / BPS, remainingTreasury);
            if (reward > 0) {
                remainingTreasury -= reward;
                referralOwed[ref] += reward;
                emit ReferralReward(day, ref, player, reward);
            }
        }
    }

    /// @notice Start claiming a winning score NFT. Freezes it (no transfer) and starts
    /// CLAIM_DELAY. Must be called by whoever owns the NFT right now.
    function claimIntent(uint256 tokenId) external {
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();
        if (prizeOf[tokenId] == 0) revert NothingToClaim();
        if (claimed[tokenId]) revert AlreadyClaimed();
        if (claimIntentAt[tokenId] != 0) return; // already started, idempotent
        claimIntentAt[tokenId] = block.timestamp;
        emit ClaimIntent(tokenId, msg.sender, block.timestamp + CLAIM_DELAY);
    }

    /// @notice Pay out a frozen score NFT's prize, once CLAIM_DELAY has passed since claimIntent.
    function claimFinalize(uint256 tokenId) external nonReentrant {
        uint256 startedAt = claimIntentAt[tokenId];
        if (startedAt == 0) revert ClaimNotIntended();
        if (block.timestamp < startedAt + CLAIM_DELAY) revert TooEarly();
        if (block.timestamp > startedAt + CLAIM_WINDOW) revert ClaimClosed();
        if (claimed[tokenId]) revert AlreadyClaimed();
        address holder = ownerOf(tokenId); // unchanged since claimIntent froze transfer
        if (holder != msg.sender) revert NotTokenOwner();
        uint256 amount = prizeOf[tokenId];
        if (amount == 0) revert NothingToClaim();
        claimed[tokenId] = true;
        uint256 day = scores[tokenId].day;
        _days[day].unclaimed -= uint128(amount);
        _send(holder, amount);
        emit PrizeClaimed(tokenId, holder, amount);
    }

    /// @notice After CLAIM_WINDOW from claimIntent (or indefinitely if claimIntent was never
    /// called), anyone can sweep that prize back into today's pot.
    function sweep(uint256 day, uint256 tokenId) external {
        Day storage d = _days[day];
        if (d.settledAt == 0) revert NotSettled();
        uint256 amount = prizeOf[tokenId];
        if (amount == 0 || claimed[tokenId]) revert NothingToClaim();
        uint256 startedAt = claimIntentAt[tokenId];
        bool expired = startedAt != 0 && block.timestamp > startedAt + CLAIM_WINDOW;
        bool stale = startedAt == 0 && block.timestamp > d.settledAt + CLAIM_WINDOW;
        if (!expired && !stale) revert ClaimOpen();
        claimed[tokenId] = true;
        prizeOf[tokenId] = 0;
        d.unclaimed -= uint128(amount);
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

    /// @notice Anyone can push both shares out: the buyback half to `treasury`, the backers' half to `backers`.
    function withdrawTreasury() external nonReentrant {
        uint256 amount = treasuryOwed;
        uint256 toBackers = backersOwed;
        if (amount + toBackers == 0) revert NothingToClaim();
        treasuryOwed = 0;
        backersOwed = 0;
        if (amount != 0) _send(treasury, amount);
        if (toBackers != 0) _send(backers, toBackers);
        emit TreasuryWithdrawn(treasury, amount);
        emit TreasuryWithdrawn(backers, toBackers);
    }

    // ── HamScore: minimal ERC-721, one minted per played run ───────────────────
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
        if (ownerOf(tokenId) != from) revert NotTokenOwner();
        if (to == address(0)) revert ZeroAddress();
        if (msg.sender != from && msg.sender != _approved[tokenId] && !_operator[from][msg.sender]) revert NotAuthorized();
        if (isFrozen(tokenId)) revert TokenFrozen();
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
        return id == 0x01ffc9a7 || id == 0x80ac58cd || id == 0x5b5e139f;
    }

/// @notice Fully on-chain metadata. With HamScoreArt set, the image is the day's maze as far as
    /// the run got. While the run's day is still live the image is sealed to the entrance corner, so
    /// no Score shows walls of a maze people are still racing; it develops by itself after 00:00 UTC.
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ScoreRecord memory s = scores[tokenId];
        if (s.player == address(0)) revert NoSuchToken();
        string memory idStr = _toString(tokenId);
        bool isSealed = block.timestamp < (uint256(s.day) + 1) * 1 days;
        string memory svg = scoreArt != address(0)
            ? IHamScoreArt(scoreArt).render(tokenId, s.day, s.points, s.timeMs, s.kills, s.completed, isSealed)
            : _plainSvg(s, idStr);
        string memory json = string.concat(
            '{"name":"HAM Score #', idStr,
            '","description":"A played run of HAM. Whoever holds this NFT claims its prize if it ranks top 3 for the day, not necessarily whoever played it.",',
            '"image":"data:image/svg+xml;base64,', _base64(bytes(svg)), '",',
            '"attributes":', _attributes(s, isSealed), '}'
        );
        return string.concat("data:application/json;base64,", _base64(bytes(json)));
    }

    function _attributes(ScoreRecord memory s, bool isSealed) internal pure returns (string memory) {
        return string.concat(
            '[{"trait_type":"Day","value":', _toString(s.day),
            '},{"trait_type":"Points","value":', _toString(s.points),
            '},{"trait_type":"Run of the day","value":', _toString(uint256(s.attempt) + 1),
            '},{"trait_type":"First try","value":"', (s.attempt == 0 ? "true" : "false"),
            '"},{"trait_type":"Time (ms)","value":', _toString(s.timeMs),
            '},{"trait_type":"Kills","value":', _toString(s.kills),
            '},{"trait_type":"Completed","value":"', (s.completed ? "true" : "false"),
            '"},{"trait_type":"Maze","value":"', (isSealed ? "Sealed" : "Developed"), '"}]'
        );
    }

    /// A plain stand-in picture, only until HamScoreArt is set.
    function _plainSvg(ScoreRecord memory s, string memory idStr) internal pure returns (string memory) {
        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#2a2733"/>',
            '<text x="100" y="104" font-family="monospace" font-size="13" fill="#f6e4b4" text-anchor="middle">HAM Score No. ', idStr, ': ', _toString(s.points), ' pts</text></svg>'
        );
    }

    // ── Admin ───────────────────────────────────────────────────────────────────
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

    /// @notice Where the treasury share goes. Can point at a buyback vault for an existing
    /// token instead of a plain wallet; this contract itself never mints or holds any token.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Where the backers' fixed 10% goes, e.g. a splitter that pays the campaign's backers.
    function setBackers(address backers_) external onlyOwner {
        if (backers_ == address(0)) revert ZeroAddress();
        backers = backers_;
        emit BackersSet(backers_);
    }

    /// @notice The day the backers' 10% stops (the campaign stream's end); after it, that 10% rolls over.
    /// Must be a future day, and once set it can only be pushed later, never brought forward.
    function setBackersEnd(uint256 day) external onlyOwner {
        if (day <= currentDay() || (backersEndDay != 0 && day < backersEndDay)) revert BadBackersEnd();
        backersEndDay = day;
        emit BackersEndSet(day);
    }

    function setHolderToken(address token) external onlyOwner {
        holderToken = token;
        emit HolderTokenSet(token);
    }

    /// @notice The power-up NFT to notify after each run (kills, whether the maze was completed).
    /// Zero turns the notification off; a reverting power-up contract never blocks a run either way.
    function setPowerUp(address powerUp_) external onlyOwner {
        powerUp = powerUp_;
        emit PowerUpSet(powerUp_);
    }

    /// @notice HAM Points, minted after each run at one point per ranked point. Zero turns it off.
    function setHamPoints(address hamPoints_) external onlyOwner {
        hamPoints = hamPoints_;
        emit HamPointsSet(hamPoints_);
    }

    /// @notice The contract that draws Scores. Zero falls back to a plain card. Swappable until
    /// `lockScoreArt`, after which the art can never change.
    function setScoreArt(address scoreArt_) external onlyOwner {
        if (scoreArtLocked) revert ArtLocked();
        scoreArt = scoreArt_;
        emit ScoreArtSet(scoreArt_);
    }

    function lockScoreArt() external onlyOwner {
        if (scoreArt == address(0)) revert ZeroAddress();
        scoreArtLocked = true;
        emit ScoreArtLocked();
    }

    function setBoosters(Booster[] calldata list) external onlyOwner {
        if (list.length > MAX_BOOSTERS) revert BadBooster();
        delete _boosters;
        for (uint256 i; i < list.length; ++i) {
            if (list[i].token == address(0) || list[i].bps == 0 || list[i].bps > MAX_BOOST_BPS) revert BadBooster();
            _boosters.push(list[i]);
        }
        emit BoostersSet(list);
    }

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
        if (referrer != address(0) && referrer != player && referrerOf[referrer] != player) {
            referrerOf[player] = referrer;
            emit ReferrerSet(player, referrer);
        }
    }

    function _mintScore(uint256 day, address player, uint32 attempt, uint32 points, RunResult calldata r)
        internal
        returns (uint256 tokenId)
    {
        tokenId = ++totalSupply;
        scores[tokenId] = ScoreRecord({
            day: uint64(day), player: player, attempt: attempt, points: points, timeMs: r.timeMs, kills: r.kills, completed: r.completed
        });
        _owner[tokenId] = player;
        _balance[player] += 1;
        emit Transfer(address(0), player, tokenId);
    }

    /// @dev Keeps the top three sorted by points (then faster time). `tokenId` is this run's own
    /// NFT, so unlike HamDailyRun's per-player ranking, a player's older runs stay ranked unless
    /// this one beats them outright - only one entry per tokenId can ever occupy a slot.
    function _rank(Day storage d, uint256 tokenId, uint32 points, uint32 timeMs) internal {
        for (uint256 i; i < 3; ++i) {
            if (
                d.topToken[i] == 0 || points > d.topPoints[i]
                    || (points == d.topPoints[i] && timeMs < d.topTime[i])
            ) {
                for (uint256 j = 2; j > i; --j) {
                    d.topToken[j] = d.topToken[j - 1];
                    d.topPoints[j] = d.topPoints[j - 1];
                    d.topTime[j] = d.topTime[j - 1];
                }
                d.topToken[i] = tokenId;
                d.topPoints[i] = points;
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
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        if (v != 27 && v != 28) return address(0);
        return ecrecover(h, v, r, s);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
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

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data) external returns (bytes4);
}
