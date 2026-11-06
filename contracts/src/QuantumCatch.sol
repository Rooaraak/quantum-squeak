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

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}

/// @title Quantum Catch
/// @notice A free game on Sepolia (no value, no token, nothing to pay). Every night the real hamster Squeektoshi's wheel
///         run programs a quantum walk on a ring of 16 spots that runs on a real IBM quantum computer the next morning.
///         Before his night you cast a NET on one spot (an ERC-721). A spot is CATCHABLE that night if it is in reach
///         and the chip lands on it in at least 1 % of its shots; a net on a catchable spot catches that spot's hamster,
///         otherwise the hamster got away. A net on a spot out of reach tonight never catches. Rarity is the spot's
///         rank among the night's catchable spots by landings: the one with the fewest is Epic, the next Rare, the two
///         after that Uncommon, the rest Common; the Epic spot is Legendary when the chip's very first shot of the night
///         landed on it.
///         The net resolves in place once the hatcher posts the night's chip result. If no result is posted within
///         14 days after the night ends, the net reads "No chip result" for good.
/// @dev No owner, no admin, no pause, no proxy, no setters, no withdraw, nothing payable. The immutable HATCHER can only
///      post one result record per finished night, inside the post window; it can never mint, hold, move, approve or
///      burn a net. The contract cannot check the posted numbers (they come from the hatcher's off-chain run); it
///      checks only that they are self-consistent. The immutable ART (PaintedArt, or none) only paints a caught
///      hamster; the immutable RENDERER (CatchArt, created by the constructor: pure functions, no storage) writes the
///      metadata, in its own contract only to keep this one under the EIP-170 size cap.
///      A Squeek day runs 12:00 to 12:00 UTC: night(t) = (t - 43200) / 86400. Nets for night n close 9 h after it
///      starts (21:00 UTC, before he starts running at 21:10-21:40 UTC); after that, new nets go to night n + 1.
///      Reach: the walk starts on spot turns % 16 (his start) and each step moves it one spot, so after k steps a
///      perfect walk lands only on positions with the parity of k that are at most k spots from his start around the
///      ring: a spot is in reach that night iff (spot + turns + steps) is even AND its ring distance from spot
///      turns % 16 is at most steps (position = spot - turns mod 16). From 7 steps on the distance never excludes a
///      spot of the right parity. Landings on a spot out of reach are chip noise, so a net there never catches:
///      GOT_AWAY, tier 0, its landings still shown, and the metadata says why. Known gap (contracts/README.md): a step
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

    // ------------------------------------------------------------------ events

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
    /// @dev ERC-4906: every net of the posted night has new metadata
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);
    event NetCast(uint32 indexed night, address indexed catcher, uint8 spot, uint256 tokenId);
    event NightPosted(
        uint32 indexed night, uint32 shots, uint32 turns, bytes32 jobId, bytes32 resultSha256, uint8 firstShot
    );

    // ------------------------------------------------------------------ errors

    error ZeroHatcher();
    error ArtHasNoCode(address art);
    error TimeOutOfRange(uint256 t);
    error SpotOutOfRange(uint8 spot);
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
        address owner; // nonzero = exists (nets are never burned)
        uint8 spot;
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

    constructor(address hatcher, IPaintedArt art) {
        if (hatcher == address(0)) revert ZeroHatcher();
        if (address(art) != address(0) && address(art).code.length == 0) revert ArtHasNoCode(address(art));
        HATCHER = hatcher;
        ART = art;
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

    /// @notice cast your net on one of the 16 spots for the open night; free, one per wallet per night
    function castNet(uint8 spot) external returns (uint256 tokenId) {
        if (spot >= SPOTS) revert SpotOutOfRange(spot);
        if (msg.sender == HATCHER) revert HatcherIsNotAPlayer();
        uint32 n = openNightAt(block.timestamp);
        tokenId = netId(n, msg.sender);
        // the id encodes the CASTER, so a net given away still blocks a second net from the same wallet
        if (_nets[tokenId].owner != address(0)) revert AlreadyCast(n, msg.sender);
        _nets[tokenId] = Net({owner: msg.sender, spot: spot});
        unchecked {
            ++_balances[msg.sender];
        }
        emit Transfer(address(0), msg.sender, tokenId);
        emit NetCast(n, msg.sender, spot, tokenId);
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
    /// @return status 0 waiting for the chip, 1 caught, 2 got away (under 1 %, or out of reach tonight), 3 he slept,
    ///         4 no chip result (none was posted before postDeadline(night): final)
    /// @return night the night the net was cast for
    /// @return spot the spot the net is on
    /// @return hits the chip's landings on that spot (shown even when out of reach: then they are chip noise)
    /// @return shots the chip's shots that night
    /// @return tier 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary: the rank among the night's catchable spots
    ///         (tiersOf; always 0 out of reach)
    /// @return looks the hamster's 4 traits: bit 0 hat, bit 1 glasses, bit 2 neckwear, bit 3 face (= the spot)
    function result(uint256 tokenId)
        external
        view
        returns (uint8 status, uint32 night, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks)
    {
        CatchArt.Card memory c = _card(tokenId);
        return (c.status, c.night, c.spot, c.hits, c.shots, c.tier, c.spot);
    }

    /// @notice whether a perfect walk could land on this net's spot that night: 0 not known (waiting, he slept, no
    ///         chip result), 1 in reach (the right parity and at most `steps` spots from his start, spot turns % 16),
    ///         2 out of reach tonight (landings there are chip noise; the net never catches)
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
        Net memory t = _nets[tokenId];
        if (t.owner == address(0)) revert NonexistentToken(tokenId);
        c.night = uint32(tokenId >> 160);
        c.spot = t.spot;
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
        c.hits = uint16(c.counts >> (16 * uint256(t.spot)));
        c.reach = _inReach(t.spot, r.turns, r.steps) ? IN_REACH : OUT_OF_REACH;
        // out of reach: he could not land here, so the landings here are chip noise and never catch (not catchable)
        (uint256 rank, uint256 n) = _rank(c.counts, _catchable(c.counts, c.shots, r.turns, r.steps), t.spot);
        c.rank = uint8(rank);
        c.catchable = uint8(n);
        c.tier = _tier(rank, n, r.firstShot == t.spot);
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
