// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Card, Dna, IS2Renderer} from "./S2Types.sol";

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

/// @title Quantum Catch Season 2
/// @notice A game on the Sepolia TEST network (nothing in it has money value). Season 1 (QuantumCatch v2) with a
///         hamster generator: every caught hamster gets a skin and 10 trait slots, and each slot draws its own shot.
///         Every night the real hamster Squeektoshi's wheel run programs a quantum walk on a ring of 16 spots that runs
///         on a real IBM quantum computer the next day. Before his night you cast a NET (an ERC-721): a ticket for one
///         of the chip's shots. Nobody picks a spot. Once the hatcher posts the night's chip result and the night is
///         SEALED (seal: anyone, from two blocks after the post on), each net gets exactly one of the night's shots,
///         drawn at random over ALL its landings, so the chip's landings decide the spot: a spot with more landings is
///         drawn more often. A spot is CATCHABLE that night if it is in reach and the chip lands on it in at least 1 %
///         of its shots; a net whose shot landed on a catchable spot catches that spot's hamster, otherwise the hamster
///         got away. Rarity is the drawn spot's rank among the night's catchable spots by landings: the one with the
///         fewest is Epic, the next Rare, the two after that Uncommon, the rest Common; the Epic spot is Legendary when
///         the chip's very first shot of the night landed on it. A caught net's 10 trait slots (Face, Head, Eyes, Mouth,
///         Neck, Hands, Back, Special, Aura, Background) each draw one more shot the same way, and that shot's spot
///         tier is the slot's tier (dnaOf). What a tier shows (the trait lists, the art, the names) is the renderer's.
///         If no result is posted within 14 days after the night ends, the net reads "No chip result" for good. A night
///         he slept draws nothing. A net costs NET_COST of the Squeekchain TEST token SQK, burned in the same call.
///         A net's holder (or an address it approved) can burn it; nobody else can.
/// @dev THE PICTURES CAN CHANGE UNTIL LOCK, THE DRAW NEVER. The deployer is the owner, and the owner can do exactly two
///      things: setRenderer (the contract that turns a net's numbers into its picture, names and metadata text) and
///      lock (owner = address(0) forever: then nothing can ever change). No other owner power: no mint, no withdraw, no
///      pause, no proxy, no cost/clock/hatcher/SQK change, nothing payable. The draw is fixed in this contract:
///      dnaOf, result, drawOf, tiersOf, spotOf, reachOf, nightRecord and sealOf never read the renderer.
///      The immutable HATCHER can only post one result record per finished night, inside the post window; it can never
///      mint, hold, move, approve or burn a net, and it is not a player. The contract cannot check the posted numbers
///      (they come from the hatcher's off-chain run); it checks only that they are self-consistent.
///      The seal (the owner's rule A1, 6 Nov; the review's R1, 7 Nov): postNight records its block P. From block P + 2
///      on, anyone can call seal(n) once: seed = keccak256(abi.encode(h, resultSha256, jobId)) where h is the hash of
///      block P + 1, the block right after the post, which nobody knew when the numbers were posted. Its source: BLOCKHASH
///      while P + 1 is among the last 256 blocks (to block P + 257); then the EIP-2935 block-history contract, which keeps
///      the last 8191 block hashes (to block P + 8192, about 27 hours on Sepolia): the same hash, so the same seed, however
///      late the seal comes. Only if nobody sealed by then: the hash of the newest block P + 1 + 256 k before the seal (a
///      late sealer gets one new seed per 256 blocks, not one per block; the hatcher's tools seal at once, and anyone can).
///      Draws (all from the stored seed, never from a view-time block hash):
///        main:   w0 = uint256(keccak256(abi.encode(uint32 night, bytes32 seed, uint256 tokenId)))
///        slot k: wk = uint256(keccak256(abi.encode(uint32 night, bytes32 seed, uint256 tokenId, uint256 k))), k = 1..10
///      each walked to a spot: x = w % shots, then spots 0..15 in order, each taking its count of the values. The
///      main spot's tier decides caught / got away and the rarity; each slot's spot tier is that slot's tier. The modulo
///      bias is below 2^-235 (shots <= 16 * 65535).
///      The clock (DAY, DAY_OFFSET, LOCK, nightOf, openNightAt) is byte for byte v2's, so v2's SqkFaucet (which only
///      calls the pure openNightAt) serves this game too.
///      The immutable SQK and NET_COST: castNet takes exactly NET_COST from the caller's own allowance and burns it at
///      once, so the game's SQK balance is the same before and after every cast.
///      Reach: the walk starts on spot turns % 16 and each step moves it one spot, so after k steps a perfect walk lands
///      only on positions with the parity of k that are at most k spots from his start around the ring. Landings on a
///      spot out of reach are chip noise, so a net whose shot is drawn there never catches.
contract QuantumCatchV3 {
    // ------------------------------------------------------------------ constants

    string public constant name = "Quantum Catch Season 2";
    string public constant symbol = "QCATCH2";
    uint256 public constant DAY = 86400;
    uint256 public constant DAY_OFFSET = 43200; // Squeek days start at 12:00 UTC
    uint256 public constant LOCK = 32400; // nets close 9 h into the Squeek day (21:00 UTC)
    uint8 public constant SPOTS = 16;
    /// @notice the chip result for night n can be posted until (not at) nightOverAt(n) + POST_WINDOW; after that the
    ///         night can never be posted and its nets read "No chip result"
    uint256 public constant POST_WINDOW = 14 days;
    /// @notice the most steps any recipe has used (v1: 16, v1.2: 10)
    uint8 public constant MAX_STEPS = 16;
    /// @notice the EIP-2935 block-history contract (Prague): staticcall with a block number (32 bytes) returns that
    ///         block's hash for the last HISTORY_WINDOW blocks, else reverts
    address public constant BLOCK_HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    uint256 public constant HISTORY_WINDOW = 8191;
    /// @notice the trait slots of a caught hamster (1 Face .. 10 Background)
    uint8 public constant SLOTS = 10;
    /// @dev every time whose night (and the night after it) fits in uint32
    uint256 internal constant MAX_TIME = uint256(type(uint32).max) * DAY + DAY_OFFSET;

    uint8 public constant WAITING = 0;
    uint8 public constant CAUGHT = 1;
    uint8 public constant GOT_AWAY = 2;
    uint8 public constant SLEPT = 3;
    uint8 public constant NO_RESULT = 4;
    /// @notice the night is posted but not sealed yet: nothing is drawn (anyone can seal it two blocks after the post)
    uint8 public constant DRAWING = 5;

    /// @notice result().spot / spotOf before a spot is drawn (waiting, drawing, he slept, no chip result)
    uint8 public constant NO_SPOT = 255;

    uint8 public constant REACH_UNKNOWN = 0; // waiting, drawing, he slept, or no chip result
    uint8 public constant IN_REACH = 1;
    uint8 public constant OUT_OF_REACH = 2; // a perfect walk cannot land here tonight: never catches (landings = noise)

    uint8 internal constant COMMON = 1;
    uint8 internal constant UNCOMMON = 2;
    uint8 internal constant RARE = 3;
    uint8 internal constant EPIC = 4;
    uint8 internal constant LEGENDARY = 5;

    /// @notice the only account that can post a night's chip result (and nothing else)
    address public immutable HATCHER;
    /// @notice the token a net is paid in and burned (Squeekchain TEST SQK; address(0) = free nets)
    ISqk public immutable SQK;
    /// @notice the SQK burned per net (0 when SQK is unset: free)
    uint256 public immutable NET_COST;

    /// @notice the owner (the deployer) until lock(); its only powers are setRenderer and lock. address(0) = locked
    address public owner;
    /// @notice the contract that draws the pictures and writes the metadata (owner-set until lock, then fixed forever)
    IS2Renderer public renderer;

    // ------------------------------------------------------------------ events

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// @dev ERC-4906: these nets have new metadata (a post, a seal, a new renderer)
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    /// @notice `catcher` cast its net `tokenId` for `night` (no spot: the night's chip result and seal draw it)
    event NetCast(uint32 indexed night, address indexed catcher, uint256 tokenId);
    /// @notice `catcher` paid `burned` SQK for its net of `night`, and it was burned (not emitted for free nets)
    event NetPaid(uint32 indexed night, address indexed catcher, uint256 burned);
    event NightPosted(
        uint32 indexed night, uint32 shots, uint32 turns, bytes32 jobId, bytes32 resultSha256, uint8 firstShot
    );
    /// @notice night `night` is sealed: its draws use `seed` = keccak256(abi.encode(blockHash, resultSha256, jobId)),
    ///         blockHash being the hash of block `seedBlock`
    event NightSealed(uint32 indexed night, uint256 seedBlock, bytes32 blockHash, bytes32 seed);
    /// @notice the owner set a new renderer (every net's picture may change)
    event RendererSet(address indexed previous, address indexed renderer);
    /// @notice the owner locked the game: no owner, the renderer is fixed forever
    event Locked(address indexed by, address renderer);

    // ------------------------------------------------------------------ errors

    error ZeroHatcher();
    error RendererHasNoCode(address renderer);
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
    error NotPosted(uint32 night);
    error AlreadySealed(uint32 night);
    /// @dev the hash of block postBlock + 1 exists from block postBlock + 2 on
    error SealTooEarly(uint32 night, uint256 sealableAt);
    error NotOwner();
    error RendererFailed();
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
        uint64 postBlock; // the block of the postNight transaction
        uint64 seedBlock; // the block whose hash sealed the draws (0 = not sealed yet)
        bytes32 jobId; // the IBM job id, ASCII, right-padded with zero bytes
        bytes32 resultSha256; // sha256 of the result file the counts come from
        bytes32 seed; // the draw seed (set once by seal)
    }

    mapping(uint256 => Net) private _nets;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operators;
    mapping(uint32 => Night) private _nights;

    /// @param renderer_ the first renderer (the owner can replace it until lock)
    /// @param sqk the token a net is paid in and burned; address(0) = free nets (then netCost must be 0)
    /// @param netCost the SQK burned per net (> 0 when sqk is set)
    constructor(address hatcher, IS2Renderer renderer_, ISqk sqk, uint256 netCost) {
        if (hatcher == address(0)) revert ZeroHatcher();
        if (address(renderer_).code.length == 0) revert RendererHasNoCode(address(renderer_));
        if (address(sqk) == address(0)) {
            if (netCost != 0) revert BadNetCost(netCost);
        } else {
            if (address(sqk).code.length == 0) revert SqkHasNoCode(address(sqk));
            if (netCost == 0) revert BadNetCost(netCost);
        }
        HATCHER = hatcher;
        SQK = sqk;
        NET_COST = netCost;
        owner = msg.sender;
        renderer = renderer_;
        emit RendererSet(address(0), address(renderer_));
    }

    // ------------------------------------------------------------------ the owner (pictures only, until lock)

    /// @notice the owner sets the renderer: how every net looks (art, trait lists, names, metadata text). Never the
    ///         draw: dnaOf, result and every number stay exactly as they are. Not after lock().
    function setRenderer(IS2Renderer r) external {
        _onlyOwner();
        if (address(r).code.length == 0) revert RendererHasNoCode(address(r));
        emit RendererSet(address(renderer), address(r));
        renderer = r;
        emit BatchMetadataUpdate(0, type(uint256).max);
    }

    /// @notice the owner gives up its powers for good: the renderer (and so every picture) is fixed forever
    function lock() external {
        _onlyOwner();
        owner = address(0);
        emit Locked(msg.sender, address(renderer));
    }

    /// @dev the owner, and never anyone once locked (owner = address(0): not even a call from address(0))
    function _onlyOwner() internal view {
        address o = owner;
        if (o == address(0) || msg.sender != o) revert NotOwner();
    }

    /// @notice true once lock() ran: nothing about this game can change any more
    function locked() external view returns (bool) {
        return owner == address(0);
    }

    // ------------------------------------------------------------------ time (byte for byte v2)

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

    /// @notice cast your net for the open night, one per wallet per night: a ticket for one of the chip's shots. With
    ///         SQK set it costs NET_COST SQK, burned in this call: approve this game for NET_COST first (or use
    ///         castNetWithPermit)
    function castNet() external returns (uint256 tokenId) {
        return _castNet();
    }

    /// @notice castNet in one transaction without a separate approve: first sets this game's allowance to NET_COST
    ///         from your EIP-2612 permit signature (owner = you, spender = this game, value = NET_COST), then casts.
    ///         If the permit cannot be used (someone already submitted it, or it is invalid) it is ignored and the
    ///         allowance already there is used; without enough allowance the cast reverts. An EIP-2612 permit SETS the
    ///         allowance: a larger allowance given before is replaced by NET_COST, which the cast then uses up.
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

    /// @notice burn net `tokenId`: by its holder, or an address the holder approved for this net or for all its nets.
    ///         It is gone for good, and its id can never be cast again.
    function burn(uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && _approved[tokenId] != msg.sender && !_operators[holder][msg.sender]) {
            revert NotOwnerNorApproved(msg.sender, tokenId);
        }
        delete _approved[tokenId];
        unchecked {
            --_balances[holder];
        }
        _nets[tokenId].owner = address(0); // `cast` stays set
        emit Transfer(holder, address(0), tokenId);
    }

    /// @notice the hatcher posts night n's chip result once, after the night is over and before postDeadline(n); the
    ///         night's nets read DRAWING until someone seals it (seal, from two blocks later on)
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
        r.postBlock = uint64(block.number);
        r.jobId = jobId;
        r.resultSha256 = resultSha256;
        emit NightPosted(n, uint32(shots), turns, jobId, resultSha256, firstShot);
        emit BatchMetadataUpdate(uint256(n) << 160, (uint256(n) << 160) | type(uint160).max);
    }

    /// @notice fix night n's draw seed, once, by anyone, from block postBlock + 2 on: keccak256(abi.encode(the hash of
    ///         block postBlock + 1, resultSha256, jobId)), that hash from BLOCKHASH (to postBlock + 257) or the EIP-2935
    ///         history (to postBlock + 8192); later, the hash of the newest block postBlock + 1 + 256 k (sealBlockFor)
    function seal(uint32 n) external returns (bytes32 seed) {
        Night storage r = _nights[n];
        if (!r.posted) revert NotPosted(n);
        if (r.seedBlock != 0) revert AlreadySealed(n);
        uint256 t = uint256(r.postBlock) + 1;
        if (block.number <= t) revert SealTooEarly(n, t + 1);
        (uint256 b, bytes32 h) = _sealHash(t);
        seed = keccak256(abi.encode(h, r.resultSha256, r.jobId));
        r.seedBlock = uint64(b);
        r.seed = seed;
        emit NightSealed(n, b, h, seed);
        emit BatchMetadataUpdate(uint256(n) << 160, (uint256(n) << 160) | type(uint160).max);
    }

    /// @notice the block whose hash a seal sent now would use for a night posted in block postBlock: postBlock + 1 while
    ///         BLOCKHASH (256 blocks) or the EIP-2935 history (8191 blocks) still has it, else the newest
    ///         postBlock + 1 + 256 k before this block (0 before postBlock + 2)
    function sealBlockFor(uint256 postBlock) external view returns (uint256 b) {
        if (block.number <= postBlock + 1) return 0;
        (b,) = _sealHash(postBlock + 1);
    }

    /// @dev block t's hash (t < block.number) from BLOCKHASH or the EIP-2935 history; when neither has it any more, the
    ///      newest block t + 256 k below this one, which BLOCKHASH always has (block.number - 1 - b < 256)
    function _sealHash(uint256 t) internal view returns (uint256 b, bytes32 h) {
        if (block.number - t <= 256) return (t, blockhash(t));
        h = _history(t);
        if (h != bytes32(0)) return (t, h);
        b = t + 256 * ((block.number - 1 - t) / 256);
        h = blockhash(b);
    }

    /// @dev block t's hash from the EIP-2935 contract, or 0 when it does not answer with one (no contract on this chain,
    ///      t outside its window, an empty slot)
    function _history(uint256 t) internal view returns (bytes32 h) {
        (bool ok, bytes memory ret) = BLOCK_HISTORY.staticcall(abi.encode(t));
        if (ok && ret.length == 32) h = abi.decode(ret, (bytes32));
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

    /// @notice night n's seal: the post's block, the block whose hash sealed it (0 = not sealed yet) and the seed
    function sealOf(uint32 n) external view returns (uint64 postBlock, uint64 seedBlock, bytes32 seed) {
        Night storage r = _nights[n];
        return (r.postBlock, r.seedBlock, r.seed);
    }

    /// @notice the tier of every spot for a night's numbers (v2's rule): a spot is catchable if it is in reach and got
    ///         at least 1 % of the shots; the catchable spots are ranked by landings, most first, equal landings the
    ///         lower spot first; with n of them, rank n is Epic (Legendary when it is firstShot), n - 1 Rare, n - 3 and
    ///         n - 2 Uncommon, the rest Common. Every other spot: 0.
    /// @return tiers 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary, per spot
    function tiersOf(uint16[16] calldata counts, uint32 turns, uint8 steps, uint8 firstShot)
        external
        pure
        returns (uint8[16] memory tiers)
    {
        (uint256 packed, uint256 shots) = _pack(counts);
        return _tiers(packed, shots, turns, steps, firstShot);
    }

    /// @notice the spot of the shot drawn for net `tokenId` (main draw) for a night's numbers and seed:
    ///         x = uint256(keccak256(abi.encode(n, seed, tokenId))) % shots, then spots 0..15 in order, each taking its
    ///         count of the values. NO_SPOT when nothing landed (he slept).
    function drawOf(uint32 n, bytes32 seed, uint256 tokenId, uint16[16] calldata counts) external pure returns (uint8) {
        (uint256 packed, uint256 shots) = _pack(counts);
        if (shots == 0) return NO_SPOT;
        (uint8 s,) = _walk(packed, shots, uint256(keccak256(abi.encode(n, seed, tokenId))));
        return s;
    }

    /// @notice the raw DNA of net `tokenId` for a night's numbers and seed (the same as dnaOf once that night is posted
    ///         with these numbers and sealed with this seed): status 1 caught or 2 got away (3 when he slept)
    function dnaFor(
        uint32 n,
        bytes32 seed,
        uint256 tokenId,
        uint16[16] calldata counts,
        uint32 turns,
        uint8 steps,
        uint8 firstShot
    ) external pure returns (Dna memory d) {
        (uint256 packed, uint256 shots) = _pack(counts);
        if (shots == 0) {
            d.status = SLEPT;
            return d;
        }
        uint8[16] memory tiers = _tiers(packed, shots, turns, steps, firstShot);
        (uint8 spot, bytes32 w0) = _mainDraw(n, seed, tokenId, packed, shots);
        if (tiers[spot] == 0) {
            d.status = GOT_AWAY;
            return d;
        }
        return _dna(n, seed, tokenId, packed, shots, tiers, spot, w0);
    }

    function _pack(uint16[16] calldata counts) internal pure returns (uint256 packed, uint256 shots) {
        for (uint256 i; i < 16; ++i) {
            packed |= uint256(counts[i]) << (16 * i);
            shots += counts[i];
        }
    }

    function _tiers(uint256 packed, uint256 shots, uint256 turns, uint256 steps, uint256 firstShot)
        internal
        pure
        returns (uint8[16] memory tiers)
    {
        uint256 mask = _catchable(packed, shots, turns, steps);
        for (uint256 s; s < 16; ++s) {
            (uint256 rank, uint256 n) = _rank(packed, mask, s);
            tiers[s] = _tier(rank, n, s == firstShot);
        }
    }

    function _mainDraw(uint32 n, bytes32 seed, uint256 tokenId, uint256 packed, uint256 shots)
        internal
        pure
        returns (uint8 spot, bytes32 w0)
    {
        w0 = keccak256(abi.encode(n, seed, tokenId));
        (spot,) = _walk(packed, shots, uint256(w0));
    }

    /// @dev the spot of word w's shot: x = w % shots, spots 0..15 in order (shots > 0: always a spot with a landing)
    function _walk(uint256 packed, uint256 shots, uint256 w) internal pure returns (uint8 spot, uint256 x) {
        x = w % shots;
        uint256 left = x;
        for (uint256 s; s < 16; ++s) {
            uint256 c = (packed >> (16 * s)) & 0xFFFF;
            if (left < c) return (uint8(s), x);
            left -= c;
        }
        revert NoLandings(); // unreachable: x < shots = the sum of the counts
    }

    /// @dev a caught net's raw DNA: the main draw and each slot's own shot
    function _dna(
        uint32 n,
        bytes32 seed,
        uint256 tokenId,
        uint256 packed,
        uint256 shots,
        uint8[16] memory tiers,
        uint8 spot,
        bytes32 w0
    ) internal pure returns (Dna memory d) {
        d.status = CAUGHT;
        d.tier = tiers[spot];
        d.spot = spot;
        d.shots = uint32(shots);
        d.word = w0;
        for (uint256 k = 1; k <= SLOTS; ++k) {
            bytes32 wk = keccak256(abi.encode(n, seed, tokenId, k));
            (uint8 s, uint256 x) = _walk(packed, shots, uint256(wk));
            d.words[k - 1] = wk;
            d.landings[k - 1] = uint32(x);
            d.spots[k - 1] = s;
            d.tiers[k - 1] = tiers[s];
        }
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
    /// @return status 0 waiting for the chip, 1 caught, 2 got away, 3 he slept, 4 no chip result (final), 5 posted and
    ///         drawing (not sealed yet)
    /// @return night the night the net was cast for
    /// @return spot the spot its drawn shot landed on; NO_SPOT (255) until the night is posted and sealed, and when he
    ///         slept or no result came
    /// @return hits the chip's landings on that spot (shown even when out of reach: then they are chip noise)
    /// @return shots the chip's shots that night (0 until it is posted)
    /// @return tier 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary
    /// @return looks always 0 in Season 2 (Season 1's 4 trait bits; Season 2's traits: dnaOf, traitsOf)
    function result(uint256 tokenId)
        external
        view
        returns (uint8 status, uint32 night, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks)
    {
        Card memory c = _card(tokenId);
        return (c.status, c.night, c.spot, c.hits, c.shots, c.tier, 0);
    }

    /// @notice the spot net `tokenId`'s drawn shot landed on: NO_SPOT (255) until the night is posted and sealed (and
    ///         when he slept or no result came)
    function spotOf(uint256 tokenId) external view returns (uint8) {
        return _card(tokenId).spot;
    }

    /// @notice whether a perfect walk could land on the spot of this net's drawn shot that night: 0 not known, 1 in
    ///         reach, 2 out of reach tonight (landings there are chip noise; the net never catches)
    function reachOf(uint256 tokenId) external view returns (uint8) {
        return _card(tokenId).reach;
    }

    /// @notice net `tokenId`'s raw DNA (the fair draw only; how it looks: renderer.itemsOf(dnaOf(id))). All zero but
    ///         the status unless it caught.
    function dnaOf(uint256 tokenId) external view returns (Dna memory d) {
        (, d) = _cardDna(tokenId);
    }

    /// @notice a net's traits in one stable read (for later games built on these nets). Until the night is posted and
    ///         sealed (also when no chip result came): drawn false, everything else 0. When he slept: drawn true,
    ///         caught false, spot NO_SPOT, the rest 0. The skin and item ids are the CURRENT renderer's (they can change
    ///         until lock); the tier and spot never change. slots[k - 1] is the item id slot k shows, 0 = the slot's
    ///         default (renderer.traitName names it).
    function traitsOf(uint256 tokenId)
        external
        view
        returns (uint32 night, bool drawn, bool caught, uint8 spot, uint8 tier, uint8 skin, uint8[10] memory slots)
    {
        (Card memory c, Dna memory d) = _cardDna(tokenId);
        night = c.night;
        if (c.status == WAITING || c.status == NO_RESULT || c.status == DRAWING) return (night, false, false, 0, 0, 0, slots);
        if (c.status != CAUGHT) return (night, true, false, c.spot, 0, 0, slots);
        (skin, slots) = renderer.itemsOf(d);
        return (night, true, true, c.spot, c.tier, skin, slots);
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

    function _card(uint256 tokenId) internal view returns (Card memory c) {
        (c,) = _cardDna(tokenId);
    }

    function _cardDna(uint256 tokenId) internal view returns (Card memory c, Dna memory d) {
        if (_nets[tokenId].owner == address(0)) revert NonexistentToken(tokenId);
        c.night = uint32(tokenId >> 160);
        c.spot = NO_SPOT; // nothing drawn until a ran night is posted and sealed
        Night storage r = _nights[c.night];
        if (!r.posted) {
            if (block.timestamp >= postDeadline(c.night)) c.status = NO_RESULT; // final: it can never be posted now
            d.status = c.status;
            return (c, d); // else WAITING
        }
        c.jobId = r.jobId;
        c.sha = r.resultSha256;
        if (r.turns == 0) {
            c.status = SLEPT;
            d.status = SLEPT;
            return (c, d);
        }
        c.counts = r.counts;
        c.shots = r.shots;
        c.steps = r.steps;
        c.start = r.ringTurn;
        c.firstShot = r.firstShot;
        if (r.seedBlock == 0) {
            c.status = DRAWING; // posted, not sealed: nothing drawn yet
            d.status = DRAWING;
            return (c, d);
        }
        c.seedBlock = r.seedBlock;
        c.seed = r.seed;
        uint256 shots = r.shots;
        uint8[16] memory tiers = _tiers(c.counts, shots, r.turns, r.steps, r.firstShot);
        (uint8 s, bytes32 w0) = _mainDraw(c.night, c.seed, tokenId, c.counts, shots);
        c.spot = s;
        c.hits = uint16(c.counts >> (16 * uint256(s)));
        c.reach = _inReach(s, r.turns, r.steps) ? IN_REACH : OUT_OF_REACH;
        // out of reach: he could not land there, so the landings there are chip noise and never catch (not catchable)
        (uint256 rank, uint256 n) = _rank(c.counts, _catchable(c.counts, shots, r.turns, r.steps), s);
        c.rank = uint8(rank);
        c.catchable = uint8(n);
        c.tier = tiers[s];
        if (c.tier == 0) {
            c.status = GOT_AWAY;
            d.status = GOT_AWAY;
            return (c, d);
        }
        c.status = CAUGHT;
        d = _dna(c.night, c.seed, tokenId, c.counts, shots, tiers, s, w0);
    }

    // ------------------------------------------------------------------ ERC-721 metadata

    /// @notice on-chain JSON + SVG, written by the current renderer from the net's numbers and raw DNA; its answer is
    ///         returned as is (it is already the ABI encoding of one string)
    function tokenURI(uint256 tokenId) external view returns (string memory) {
        (Card memory c, Dna memory d) = _cardDna(tokenId);
        bytes memory call_ = abi.encodeCall(IS2Renderer.tokenURI, (c, d));
        address r = address(renderer);
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(gas(), r, add(call_, 0x20), mload(call_), 0, 0)
        }
        uint256 size;
        assembly ("memory-safe") {
            size := returndatasize()
        }
        // an ABI string is at least its offset and its length (two words): anything shorter is not one
        if (!ok || size < 64) revert RendererFailed();
        assembly ("memory-safe") {
            let p := mload(0x40)
            returndatacopy(p, 0, returndatasize())
            return(p, returndatasize())
        }
    }

    // ------------------------------------------------------------------ ERC-721

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC-165
            || interfaceId == 0x80ac58cd // ERC-721
            || interfaceId == 0x5b5e139f // ERC-721 Metadata
            || interfaceId == 0x49064906; // ERC-4906 metadata update events
    }

    function balanceOf(address holder) external view returns (uint256) {
        if (holder == address(0)) revert ZeroOwner();
        return _balances[holder];
    }

    function ownerOf(uint256 tokenId) public view returns (address holder) {
        holder = _nets[tokenId].owner;
        if (holder == address(0)) revert NonexistentToken(tokenId);
    }

    function approve(address to, uint256 tokenId) external {
        address holder = ownerOf(tokenId);
        if (msg.sender != holder && !_operators[holder][msg.sender]) revert NotOwnerNorApproved(msg.sender, tokenId);
        if (to == HATCHER) revert HatcherIsNotAPlayer();
        _approved[tokenId] = to;
        emit Approval(holder, to, tokenId);
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

    function isApprovedForAll(address holder, address operator) external view returns (bool) {
        return _operators[holder][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        if (to == address(0)) revert TransferToZero();
        address holder = ownerOf(tokenId);
        if (holder != from) revert WrongFrom(from, tokenId);
        if (msg.sender != holder && _approved[tokenId] != msg.sender && !_operators[holder][msg.sender]) {
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
