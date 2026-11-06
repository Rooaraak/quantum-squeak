// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchArt} from "./CatchArt.sol";

/// @notice the painted hamster: an SVG <g> fragment of 448 x 600 user units (the page's composite: body or skin, each
///         worn item's erase layer cut out of it, then the item's shadow and the item), fully on-chain
interface IPaintedArt {
    /// @param looks the spot's 4 bits: bit 0 party hat, bit 1 glasses, bit 2 scarf, bit 3 face grin (else calm)
    /// @param tier 1 Common (body), 2 Uncommon (tiger), 3 Rare (circuit), 4 Epic (crystal), 5 Legendary (gold)
    function hamster(uint8 looks, uint8 tier) external view returns (string memory);
}

/// @notice the Squeekchain TEST token SQK on Sepolia (no money value): an ERC-20 whose burn(uint256) burns from the
///         caller's own balance, with EIP-2612 permit. Only what the game calls (and the views a page reads).
interface ISqk {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    /// @dev burns `value` from msg.sender (OpenZeppelin ERC20Burnable: no return value)
    function burn(uint256 value) external;
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title Quantum Catch
/// @notice A game on the Sepolia TEST network (nothing in it has money value). Every night the real hamster
///         Squeektoshi's wheel run programs a quantum walk on a ring of 16 spots that runs on a real IBM quantum
///         computer the next day.
///         Before his night you cast a NET (an ERC-721): a ticket for one of the chip's shots. Nobody picks a spot
///         (the owner's rule, 6 Nov). Once the hatcher posts the night's chip result, each net gets exactly one of the
///         night's shots, drawn at random over ALL its landings (drawOf), so the chip's landings decide the spot: a
///         spot with more landings is drawn more often. A spot is CATCHABLE that night if it is in reach and the chip
///         lands on it in at least 1 % of its shots; a net whose shot landed on a catchable spot catches that spot's
///         hamster, otherwise the hamster got away (out of reach: only chip noise lands there; or under 1 %). So the
///         chance of catching nothing is the chip's own noise share, decided by the quantum hardware. Rarity is the
///         drawn spot's rank among the night's catchable spots by landings: the one with the fewest is Epic, the next
///         Rare, the two after that Uncommon, the rest Common; the Epic spot is Legendary when the chip's very first
///         shot of the night landed on it.
///         The net resolves in place once the hatcher posts the night's chip result. If no result is posted within
///         14 days after the night ends, the net reads "No chip result" for good. A night he slept draws nothing.
///         A net costs NET_COST of the Squeekchain TEST token SQK (test tokens, no money value; a faucet hands them
///         out), and that SQK is burned in the same call: the game never keeps, holds or moves it anywhere else. With
///         SQK unset (address 0) nets are free (NET_COST 0), as in the first version.
///         A net's holder (or an address it approved for that net or for all its nets, such as a later game contract)
///         can burn it; nobody else can, and a burned net can never be cast again.
/// @dev No owner, no admin, no pause, no proxy, no setters, no withdraw, nothing payable. The immutable HATCHER can only
///      post one result record per finished night, inside the post window; it can never mint, hold, move, approve or
///      burn a net, and it is not a player. The contract cannot check the posted numbers (they come from the hatcher's
///      off-chain run); it checks only that they are self-consistent. The immutable ART (PaintedArt, or none) only
///      paints a caught hamster; the immutable RENDERER (CatchArt, created by the constructor: pure functions, no
///      storage) writes the metadata, in its own contract only to keep this one under the EIP-170 size cap.
///      The draw (drawOf): x = uint256(keccak256(abi.encode(night, resultSha256, jobId, tokenId))) % shots, then
///      spots 0..15 in order, each taking its count of the values (x < counts[0]: spot 0; else x - counts[0] <
///      counts[1]: spot 1; ...). It is computed when read, never stored, from the posted record. The sha256 of the
///      chip's result file and the IBM job id exist only after the chip ran, the morning after the nets closed, so
///      no caster can know or choose its draw (the token id is fixed by the night and the caster). The hatcher posts
///      the file's numbers, which anyone can check against the file, and it holds no net; but it learns every draw
///      before it posts (and could choose among chip runs or re-serialized files), so it is trusted for the draws as
///      for every number (the metadata says so). The modulo bias is below
///      2^-235 (shots <= 16 * 65535).
///      The immutable SQK and NET_COST (fixed at deploy, no setter): castNet takes exactly NET_COST from the caller's
///      own allowance (transferFrom caller -> this game) and burns it at once (SQK.burn: from this game's balance), so
///      the game's SQK balance is the same before and after every cast; it can only ever take NET_COST from a wallet
///      that casts its own net in that same call, never from anyone else, never more. SQK sent to this contract by a
///      plain transfer stays here for good (there is no withdraw). castNetWithPermit sets that allowance from an
///      EIP-2612 signature first; a permit someone already submitted (front-run) is ignored, its allowance is used.
///      A Squeek day runs 12:00 to 12:00 UTC: night(t) = (t - 43200) / 86400. Nets for night n close 9 h after it
///      starts (21:00 UTC, before he starts running at 21:10-21:40 UTC); after that, new nets go to night n + 1.
///      Reach: the walk starts on spot turns % 16 (his start) and each step moves it one spot, so after k steps a
///      perfect walk lands only on positions with the parity of k that are at most k spots from his start around the
///      ring: a spot is in reach that night iff (spot + turns + steps) is even AND its ring distance from spot
///      turns % 16 is at most steps (position = spot - turns mod 16). From 7 steps on the distance never excludes a
///      spot of the right parity. Landings on a spot out of reach are chip noise, so a net whose shot is drawn there
///      never catches: GOT_AWAY, tier 0, its landings still shown, and the metadata says why. Known gap (contracts/README.md): a step
///      after the first with 700+ turns flips the coin fully and walks back, so such a night can call a spot in reach
///      that the walk cannot reach.
///      Rarity (the owner's rule, 5 Nov; tiersOf): the catchable spots ranked by landings, most first, equal landings
///      the lower spot first; n of them, rank r: Epic r = n, Rare r = n - 1, Uncommon r = n - 3 or n - 2, Common
///      r <= n - 4; Legendary = the Epic spot when firstShot (the chip's first shot, turned onto the ring) is on it.
contract QuantumCatch {
    // ------------------------------------------------------------------ constants

    string public constant name = "Quantum Catch";
    string public constant symbol = "QCATCH";
    uint256 public constant DAY = 86400;
    uint256 public constant DAY_OFFSET = 43200; // Squeek days start at 12:00 UTC
    uint256 public constant LOCK = 32400; // nets close 9 h into the Squeek day (21:00 UTC)
    uint8 public constant SPOTS = 16;
    /// @notice the chip result for night n can be posted until (not at) nightOverAt(n) + POST_WINDOW; after that the
    ///         night can never be posted and its nets read "No chip result"
    uint256 public constant POST_WINDOW = 14 days;
    /// @notice the most steps any recipe has used (v1: 16, v1.2: 10)
    uint8 public constant MAX_STEPS = 16;
    /// @dev every time whose night (and the night after it) fits in uint32
    uint256 internal constant MAX_TIME = uint256(type(uint32).max) * DAY + DAY_OFFSET;

    uint8 public constant WAITING = 0;
    uint8 public constant CAUGHT = 1;
    uint8 public constant GOT_AWAY = 2;
    uint8 public constant SLEPT = 3;
    uint8 public constant NO_RESULT = 4;

    /// @notice result().spot / spotOf before a spot is drawn (waiting, he slept, no chip result)
    uint8 public constant NO_SPOT = 255;

    uint8 public constant REACH_UNKNOWN = 0; // waiting, he slept, or no chip result
    uint8 public constant IN_REACH = 1;
    uint8 public constant OUT_OF_REACH = 2; // a perfect walk cannot land here tonight: never catches (landings = noise)

    uint8 internal constant COMMON = 1;
    uint8 internal constant UNCOMMON = 2;
    uint8 internal constant RARE = 3;
    uint8 internal constant EPIC = 4;
    uint8 internal constant LEGENDARY = 5;

    /// @notice the only account that can post a night's chip result (and nothing else)
    address public immutable HATCHER;
    /// @notice the painted hamster of a caught net (fixed at deploy; address(0) = the simple drawn hamster)
    IPaintedArt public immutable ART;
    /// @notice the metadata renderer (JSON + SVG), created by the constructor: pure functions only, no storage, no owner
    CatchArt public immutable RENDERER;
    /// @notice the token a net is paid in and burned (Squeekchain TEST SQK; address(0) = free nets)
    ISqk public immutable SQK;
    /// @notice the SQK burned per net (0 when SQK is unset: free)
    uint256 public immutable NET_COST;

    // ------------------------------------------------------------------ events

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// @dev ERC-4906: every net of the posted night has new metadata
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    /// @notice `catcher` cast its net `tokenId` for `night` (no spot: the night's chip result draws it)
    event NetCast(uint32 indexed night, address indexed catcher, uint256 tokenId);
    /// @notice `catcher` paid `burned` SQK for its net of `night`, and it was burned (not emitted for free nets)
    event NetPaid(uint32 indexed night, address indexed catcher, uint256 burned);
    event NightPosted(
        uint32 indexed night, uint32 shots, uint32 turns, bytes32 jobId, bytes32 resultSha256, uint8 firstShot
    );

    // ------------------------------------------------------------------ errors

    error ZeroHatcher();
    error ArtHasNoCode(address art);
    error SqkHasNoCode(address sqk);
    /// @dev free nets (SQK unset) need netCost 0; paid nets need netCost > 0
    error BadNetCost(uint256 netCost);
    /// @dev castNetWithPermit on a game with free nets: there is nothing to permit
    error FreeNets();
    error SqkTransferFailed();
    error TimeOutOfRange(uint256 t);
    error AlreadyCast(uint32 night, address catcher);
    error HatcherIsNotAPlayer();
    error NotHatcher();
    error AlreadyPosted(uint32 night);
    error NightNotOver(uint32 night, uint256 overAt);
    error PostWindowClosed(uint32 night, uint256 closedAt);
    error BadSteps(uint32 turns, uint8 steps);
    error SleptButLandings();
    error NoLandings();
    error BadFirstShot(uint8 firstShot);
    error NonexistentToken(uint256 tokenId);
    error ZeroOwner();
    error NotOwnerNorApproved(address caller, uint256 tokenId);
    error WrongFrom(address from, uint256 tokenId);
    error TransferToZero();
    error InvalidReceiver(address to);
    error InvalidOperator(address operator);

    // ------------------------------------------------------------------ storage

    struct Net {
        address owner; // the holder; nonzero = exists (zero before the cast and after a burn)
        bool cast; // set by the cast, never cleared: a burned net's id can never be cast (minted) again
    }

    struct Night {
        uint256 counts; // landings per SPOT (after the ring turn), 16 bits each, spot i at bits [16i, 16i + 16)
        uint32 shots; // sum of counts
        uint32 turns; // his total wheel turns that night (0 = he slept)
        uint8 ringTurn; // turns % 16, for transparency (the counts are already turned)
        uint8 steps; // the walk's steps that night (0 = he slept): with turns, says which spots were in reach
        bool posted;
        uint8 firstShot; // the spot the chip's very first shot of the night landed on (0 when he slept)
        bytes32 jobId; // the IBM job id, ASCII, right-padded with zero bytes
        bytes32 resultSha256; // sha256 of the result file the counts come from
    }

    mapping(uint256 => Net) private _nets;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operators;
    mapping(uint32 => Night) private _nights;

    /// @param sqk the token a net is paid in and burned; address(0) = free nets (then netCost must be 0)
    /// @param netCost the SQK burned per net (> 0 when sqk is set)
    constructor(address hatcher, IPaintedArt art, ISqk sqk, uint256 netCost) {
        if (hatcher == address(0)) revert ZeroHatcher();
        if (address(art) != address(0) && address(art).code.length == 0) revert ArtHasNoCode(address(art));
        if (address(sqk) == address(0)) {
            if (netCost != 0) revert BadNetCost(netCost);
        } else {
            if (address(sqk).code.length == 0) revert SqkHasNoCode(address(sqk));
            if (netCost == 0) revert BadNetCost(netCost);
        }
        HATCHER = hatcher;
        ART = art;
        SQK = sqk;
        NET_COST = netCost;
        RENDERER = new CatchArt();
    }

    // ------------------------------------------------------------------ time

    /// @notice the Squeek night (12:00 UTC to 12:00 UTC) that time t falls in
    function nightOf(uint256 t) public pure returns (uint32) {
        if (t < DAY_OFFSET || t >= MAX_TIME) revert TimeOutOfRange(t);
        return uint32((t - DAY_OFFSET) / DAY);
    }

    function nightStart(uint32 n) public pure returns (uint256) {
        return uint256(n) * DAY + DAY_OFFSET;
    }

    /// @notice nets for night n can be cast until (not at) this time: 21:00 UTC on its day
    function netsCloseAt(uint32 n) public pure returns (uint256) {
        return nightStart(n) + LOCK;
    }

    /// @notice the chip result for night n can be posted from this time on: 12:00 UTC the next day
    function nightOverAt(uint32 n) public pure returns (uint256) {
        return nightStart(n) + DAY;
    }

    /// @notice the chip result for night n can no longer be posted from this time on (14 days after the night ends)
    function postDeadline(uint32 n) public pure returns (uint256) {
        return nightOverAt(n) + POST_WINDOW;
    }

    /// @notice the night a net cast at time t is for
    function openNightAt(uint256 t) public pure returns (uint32) {
        uint32 n = nightOf(t);
        return t < netsCloseAt(n) ? n : n + 1;
    }

    function openNight() external view returns (uint32) {
        return openNightAt(block.timestamp);
    }

    /// @notice the token id of `catcher`'s net for night n (one per wallet per night)
    function netId(uint32 n, address catcher) public pure returns (uint256) {
        return (uint256(n) << 160) | uint160(catcher);
    }

    // ------------------------------------------------------------------ the game

    /// @notice cast your net for the open night, one per wallet per night: a ticket for one of the chip's shots (the
    ///         night's chip result draws its spot; nobody picks one). With SQK set it costs NET_COST SQK, burned in
    ///         this call: approve this game for NET_COST first (or use castNetWithPermit)
    function castNet() external returns (uint256 tokenId) {
        return _castNet();
    }

    /// @notice castNet in one transaction without a separate approve: first sets this game's allowance to NET_COST
    ///         from your EIP-2612 permit signature (owner = you, spender = this game, value = NET_COST), then casts.
    ///         If the permit cannot be used (someone already submitted it, or it is invalid) it is ignored and the
    ///         allowance already there is used; without enough allowance the cast reverts.
    ///         An EIP-2612 permit SETS the allowance: a larger allowance this wallet gave the game before (even an
    ///         unlimited one) is replaced by NET_COST, which the cast then uses up (0 left). Only the caster's own nets
    ///         ever spend it; with an allowance already in place, plain castNet is the call to use.
    function castNetWithPermit(uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 tokenId) {
        if (address(SQK) == address(0)) revert FreeNets();
        try SQK.permit(msg.sender, address(this), NET_COST, deadline, v, r, s) {} catch {}
        return _castNet();
    }

    function _castNet() internal returns (uint256 tokenId) {
        if (msg.sender == HATCHER) revert HatcherIsNotAPlayer();
        uint32 n = openNightAt(block.timestamp);
        tokenId = netId(n, msg.sender);
        // the id encodes the CASTER, so a net given away (or burned) still blocks a second net from the same wallet
        if (_nets[tokenId].cast) revert AlreadyCast(n, msg.sender);
        // effects before the token calls (checks-effects-interactions): the net is recorded before SQK runs any code
        _nets[tokenId] = Net({owner: msg.sender, cast: true});
        unchecked {
            ++_balances[msg.sender];
        }
        uint256 cost = NET_COST;
        if (cost != 0) {
            // pull exactly NET_COST from the caster (its own allowance) and burn it: the game keeps nothing
            if (!SQK.transferFrom(msg.sender, address(this), cost)) revert SqkTransferFailed();
            SQK.burn(cost);
        }
        emit Transfer(address(0), msg.sender, tokenId);
        emit NetCast(n, msg.sender, tokenId);
        if (cost != 0) emit NetPaid(n, msg.sender, cost);
    }

    /// @notice burn net `tokenId`: by its holder, or an address the holder approved for this net or for all its nets
    ///         (e.g. a later game contract the holder approves). It is gone for good: ownerOf, tokenURI, result and
    ///         traitsOf revert, it no longer counts in balanceOf, and its id can never be cast again (the id encodes
    ///         the night and the caster: the caster's net for that night stays used). No admin burn; the hatcher can
    ///         never hold or be approved for a net, so it can never burn one.
    function burn(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && _approved[tokenId] != msg.sender && !_operators[owner][msg.sender]) {
            revert NotOwnerNorApproved(msg.sender, tokenId);
        }
        delete _approved[tokenId];
        unchecked {
            --_balances[owner];
        }
        _nets[tokenId].owner = address(0); // `cast` stays set
        emit Transfer(owner, address(0), tokenId);
    }

    /// @notice the hatcher posts night n's chip result once, after the night is over and before postDeadline(n)
    /// @param counts landings per SPOT (already turned by the ring turn); all zero when he slept
    /// @param turns his total wheel turns that night; 0 = he slept
    /// @param steps the walk's steps that night (1 to 16, at most turns); 0 when he slept
    /// @param firstShot the SPOT the chip's very first shot of the night landed on (the result file's
    ///        shots_in_order[0] turned onto the ring: (position + turns) % 16); it must have a landing; 0 when he slept
    function postNight(
        uint32 n,
        uint16[16] calldata counts,
        uint32 turns,
        uint8 steps,
        bytes32 jobId,
        bytes32 resultSha256,
        uint8 firstShot
    ) external {
        if (msg.sender != HATCHER) revert NotHatcher();
        Night storage r = _nights[n];
        if (r.posted) revert AlreadyPosted(n);
        uint256 over = nightOverAt(n);
        if (block.timestamp < over) revert NightNotOver(n, over);
        if (block.timestamp >= over + POST_WINDOW) revert PostWindowClosed(n, over + POST_WINDOW);
        uint256 packed;
        uint256 shots;
        for (uint256 i; i < 16; ++i) {
            uint256 c = counts[i];
            packed |= c << (16 * i);
            shots += c;
        }
        if (turns == 0) {
            if (shots != 0) revert SleptButLandings();
            if (steps != 0) revert BadSteps(turns, steps);
            if (firstShot != 0) revert BadFirstShot(firstShot);
        } else {
            if (shots == 0) revert NoLandings();
            if (steps == 0 || steps > MAX_STEPS || steps > turns) revert BadSteps(turns, steps);
            if (firstShot >= SPOTS || counts[firstShot] == 0) revert BadFirstShot(firstShot);
        }
        r.counts = packed;
        r.shots = uint32(shots); // <= 16 * 65535
        r.turns = turns;
        r.ringTurn = uint8(turns % SPOTS);
        r.steps = steps;
        r.posted = true;
        r.firstShot = firstShot;
        r.jobId = jobId;
        r.resultSha256 = resultSha256;
        emit NightPosted(n, uint32(shots), turns, jobId, resultSha256, firstShot);
        emit BatchMetadataUpdate(uint256(n) << 160, (uint256(n) << 160) | type(uint160).max);
    }

    function nightRecord(uint32 n)
        external
        view
        returns (
            bool posted,
            uint16[16] memory counts,
            uint32 shots,
            uint32 turns,
            uint8 ringTurn,
            uint8 steps,
            bytes32 jobId,
            bytes32 resultSha256,
            uint8 firstShot
        )
    {
        Night storage r = _nights[n];
        uint256 packed = r.counts;
        for (uint256 i; i < 16; ++i) {
            counts[i] = uint16(packed >> (16 * i));
        }
        return (r.posted, counts, r.shots, r.turns, r.ringTurn, r.steps, r.jobId, r.resultSha256, r.firstShot);
    }

    /// @notice the tier of every spot for a night's numbers (the owner's rarity rule, 5 Nov): a spot is catchable if it
    ///         is in reach (_inReach) and got at least 1 % of the shots (hits * 100 >= shots); the catchable spots are
    ///         ranked by landings, most first, equal landings the lower spot first; with n of them, rank r is Epic
    ///         (r = n), Rare (r = n - 1), Uncommon (r = n - 3 or n - 2) or Common (r <= n - 4), and the Epic spot is
    ///         Legendary when it is firstShot. Every other spot: 0 (got away).
    ///         A posted night's tiers are tiersOf(its nightRecord counts, turns, steps, firstShot).
    /// @return tiers 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary, per spot
    function tiersOf(uint16[16] calldata counts, uint32 turns, uint8 steps, uint8 firstShot)
        external
        pure
        returns (uint8[16] memory tiers)
    {
        uint256 packed;
        uint256 shots;
        for (uint256 i; i < 16; ++i) {
            packed |= uint256(counts[i]) << (16 * i);
            shots += counts[i];
        }
        uint256 mask = _catchable(packed, shots, turns, steps);
        for (uint256 s; s < 16; ++s) {
            (uint256 rank, uint256 n) = _rank(packed, mask, s);
            tiers[s] = _tier(rank, n, s == firstShot);
        }
    }

    /// @notice the spot the shot drawn for net `tokenId` landed on, for a night's numbers (the owner's rule, 6 Nov): one
    ///         of the night's shots at random over ALL its landings: x = uint256(keccak256(abi.encode(n, resultSha256,
    ///         jobId, tokenId))) % shots (shots = the sum of counts), then spots 0..15 in order, each taking its count
    ///         of the values. NO_SPOT when nothing landed (he slept). A posted night's net draws
    ///         drawOf(its night, the record's resultSha256 and jobId, its id, the record's counts).
    function drawOf(uint32 n, bytes32 resultSha256, bytes32 jobId, uint256 tokenId, uint16[16] calldata counts)
        external
        pure
        returns (uint8)
    {
        uint256 packed;
        uint256 shots;
        for (uint256 i; i < 16; ++i) {
            packed |= uint256(counts[i]) << (16 * i);
            shots += counts[i];
        }
        return _draw(packed, shots, n, resultSha256, jobId, tokenId);
    }

    /// @dev the drawn shot's spot: always a spot with at least one landing; NO_SPOT when there are no shots
    function _draw(uint256 packed, uint256 shots, uint32 n, bytes32 sha, bytes32 job, uint256 tokenId)
        internal
        pure
        returns (uint8)
    {
        if (shots == 0) return NO_SPOT;
        uint256 x = uint256(keccak256(abi.encode(n, sha, job, tokenId))) % shots;
        for (uint256 s; s < 16; ++s) {
            uint256 c = (packed >> (16 * s)) & 0xFFFF;
            if (x < c) return uint8(s);
            x -= c;
        }
        return NO_SPOT; // unreachable: x < shots = the sum of the counts
    }

    /// @dev tonight's catchable spots as a 16-bit mask: in reach and at least 1 % of the shots (none when no shots)
    function _catchable(uint256 packed, uint256 shots, uint256 turns, uint256 steps) internal pure returns (uint256 mask) {
        if (shots == 0) return 0;
        for (uint256 s; s < 16; ++s) {
            if (_inReach(s, turns, steps) && ((packed >> (16 * s)) & 0xFFFF) * 100 >= shots) mask |= 1 << s;
        }
    }

    /// @dev the rank of `spot` among the catchable spots (1 = most landings; equal landings: the lower spot first) and
    ///      how many there are; rank 0 when the spot itself is not catchable
    function _rank(uint256 packed, uint256 mask, uint256 spot) internal pure returns (uint256 rank, uint256 n) {
        uint256 h = (packed >> (16 * spot)) & 0xFFFF;
        for (uint256 j; j < 16; ++j) {
            if ((mask >> j) & 1 == 0) continue;
            ++n;
            uint256 hj = (packed >> (16 * j)) & 0xFFFF;
            if (hj > h || (hj == h && j < spot)) ++rank;
        }
        rank = (mask >> spot) & 1 == 1 ? rank + 1 : 0;
    }

    /// @dev counted from the bottom of the ranking: the last is Epic (Legendary on the first shot), then Rare, then two
    ///      Uncommon, the rest Common
    function _tier(uint256 rank, uint256 n, bool firstShotHere) internal pure returns (uint8) {
        if (rank == 0) return 0;
        uint256 rarer = n - rank; // catchable spots with fewer landings than this one
        if (rarer == 0) return firstShotHere ? LEGENDARY : EPIC;
        if (rarer == 1) return RARE;
        if (rarer <= 3) return UNCOMMON;
        return COMMON;
    }

    /// @notice how a net turned out
    /// @return status 0 waiting for the chip, 1 caught, 2 got away (its shot landed under 1 %, or out of reach
    ///         tonight), 3 he slept (nothing drawn), 4 no chip result (none was posted before postDeadline(night): final)
    /// @return night the night the net was cast for
    /// @return spot the spot its drawn shot landed on (drawOf), NO_SPOT (255) until the night's result is posted, and
    ///         when he slept or no result came
    /// @return hits the chip's landings on that spot (shown even when out of reach: then they are chip noise)
    /// @return shots the chip's shots that night
    /// @return tier 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary: the drawn spot's rank among the night's
    ///         catchable spots (tiersOf; always 0 out of reach)
    /// @return looks the caught hamster's 4 traits (= the drawn spot): bit 0 hat, bit 1 glasses, bit 2 neckwear, bit 3
    ///         face; 0 unless caught
    function result(uint256 tokenId)
        external
        view
        returns (uint8 status, uint32 night, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks)
    {
        CatchArt.Card memory c = _card(tokenId);
        return (c.status, c.night, c.spot, c.hits, c.shots, c.tier, c.status == CAUGHT ? c.spot : 0);
    }

    /// @notice the spot net `tokenId`'s drawn shot landed on: NO_SPOT (255) until the night's result is posted (and
    ///         when he slept or no result came)
    function spotOf(uint256 tokenId) external view returns (uint8) {
        return _card(tokenId).spot;
    }

    /// @notice a net's traits in one stable read (for later games built on these nets). Before the night is posted
    ///         (also when no chip result came): posted false, everything else 0. When he slept: posted true, caught
    ///         false, spot NO_SPOT (nothing drawn), the rest 0.
    /// @return night the night the net was cast for
    /// @return posted whether the night's chip result is posted
    /// @return caught whether its drawn shot caught the hamster on its spot
    /// @return spot the drawn shot's spot (also when the hamster got away)
    /// @return hat the caught hamster wears a party hat (the spot's bit 0); false unless caught
    /// @return glasses round glasses (bit 1); false unless caught
    /// @return scarf a striped scarf (bit 2); false unless caught
    /// @return grin a grin, else calm (bit 3); false unless caught
    /// @return tier 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary
    function traitsOf(uint256 tokenId)
        external
        view
        returns (
            uint32 night,
            bool posted,
            bool caught,
            uint8 spot,
            bool hat,
            bool glasses,
            bool scarf,
            bool grin,
            uint8 tier
        )
    {
        CatchArt.Card memory c = _card(tokenId);
        night = c.night;
        if (c.status == WAITING || c.status == NO_RESULT) return (night, false, false, 0, false, false, false, false, 0);
        posted = true;
        spot = c.spot; // NO_SPOT when he slept
        if (c.status != CAUGHT) return (night, true, false, spot, false, false, false, false, 0);
        caught = true;
        hat = spot & 1 == 1;
        glasses = (spot >> 1) & 1 == 1;
        scarf = (spot >> 2) & 1 == 1;
        grin = (spot >> 3) & 1 == 1;
        tier = c.tier;
    }

    /// @notice whether a perfect walk could land on the spot of this net's drawn shot that night: 0 not known
    ///         (waiting, he slept, no chip result), 1 in reach (the right parity and at most `steps` spots from his
    ///         start, spot turns % 16), 2 out of reach tonight (landings there are chip noise; the net never catches)
    function reachOf(uint256 tokenId) external view returns (uint8) {
        return _card(tokenId).reach;
    }

    /// @dev after `steps` steps of +1 or -1 from spot turns % 16, a walk can only be on spots of the parity of
    ///      (turns + steps) that are at most `steps` spots away around the ring of 16
    function _inReach(uint256 spot, uint256 turns, uint256 steps) internal pure returns (bool) {
        if ((spot + turns + steps) % 2 != 0) return false;
        uint256 start = turns % SPOTS;
        uint256 d = spot > start ? spot - start : start - spot;
        if (d > SPOTS / 2) d = SPOTS - d; // ring distance, 0 to 8
        return d <= steps;
    }

    function _card(uint256 tokenId) internal view returns (CatchArt.Card memory c) {
        if (_nets[tokenId].owner == address(0)) revert NonexistentToken(tokenId);
        c.night = uint32(tokenId >> 160);
        c.spot = NO_SPOT; // nothing drawn until a ran night is posted
        Night storage r = _nights[c.night];
        if (!r.posted) {
            if (block.timestamp >= postDeadline(c.night)) c.status = NO_RESULT; // final: it can never be posted now
            return c; // else WAITING
        }
        c.jobId = r.jobId;
        c.sha = r.resultSha256;
        if (r.turns == 0) {
            c.status = SLEPT;
            return c;
        }
        c.counts = r.counts;
        c.shots = r.shots;
        c.steps = r.steps;
        c.start = r.ringTurn;
        c.firstShot = r.firstShot;
        // the net's one shot, drawn over all the night's landings (shots > 0 on a ran night: a spot with a landing)
        uint8 s = _draw(c.counts, c.shots, c.night, c.sha, c.jobId, tokenId);
        c.spot = s;
        c.hits = uint16(c.counts >> (16 * uint256(s)));
        c.reach = _inReach(s, r.turns, r.steps) ? IN_REACH : OUT_OF_REACH;
        // out of reach: he could not land there, so the landings there are chip noise and never catch (not catchable)
        (uint256 rank, uint256 n) = _rank(c.counts, _catchable(c.counts, c.shots, r.turns, r.steps), s);
        c.rank = uint8(rank);
        c.catchable = uint8(n);
        c.tier = _tier(rank, n, r.firstShot == s);
        c.status = c.tier == 0 ? GOT_AWAY : CAUGHT;
    }

    // ------------------------------------------------------------------ ERC-721 metadata

    /// @notice on-chain JSON + SVG; a caught net shows ART's painted hamster when ART is set (if ART reverts, or is
    ///         not set, the simple drawn hamster)
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        CatchArt.Card memory c = _card(tokenId);
        string memory painted;
        if (c.status == CAUGHT && address(ART) != address(0)) {
            try ART.hamster(c.spot, c.tier) returns (string memory g) {
                painted = g;
            } catch {}
        }
        return RENDERER.tokenURI(c, painted);
    }

    // ------------------------------------------------------------------ ERC-721

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 Metadata
            || interfaceId == 0x49064906; // ERC-4906 metadata update events
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroOwner();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _nets[tokenId].owner;
        if (owner == address(0)) revert NonexistentToken(tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner && !_operators[owner][msg.sender]) revert NotOwnerNorApproved(msg.sender, tokenId);
        if (to == HATCHER) revert HatcherIsNotAPlayer();
        _approved[tokenId] = to;
        emit Approval(owner, to, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        ownerOf(tokenId);
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == address(0)) revert InvalidOperator(operator);
        if (approved && operator == HATCHER) revert HatcherIsNotAPlayer();
        _operators[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operators[owner][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert TransferToZero();
        address owner = ownerOf(tokenId);
        if (owner != from) revert WrongFrom(from, tokenId);
        if (msg.sender != owner && _approved[tokenId] != msg.sender && !_operators[owner][msg.sender]) {
            revert NotOwnerNorApproved(msg.sender, tokenId);
        }
        if (to == HATCHER) revert HatcherIsNotAPlayer();
        delete _approved[tokenId];
        unchecked {
            --_balances[from];
            ++_balances[to];
        }
        _nets[tokenId].owner = to;
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, data);
    }

    function _checkReceiver(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 ret) {
            if (ret != IERC721Receiver.onERC721Received.selector) revert InvalidReceiver(to);
        } catch (bytes memory reason) {
            if (reason.length == 0) revert InvalidReceiver(to);
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
    }
}
