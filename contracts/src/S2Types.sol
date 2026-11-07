// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// Quantum Catch Season 2: the shapes QuantumCatchV3 hands its renderer.

/// One net as the game sees it (v2's CatchArt.Card plus the night's seal).
struct Card {
    uint8 status; // 0 waiting for the chip, 1 caught, 2 got away, 3 he slept, 4 no chip result, 5 posted, drawing
    uint32 night;
    uint8 spot; // the spot the net's drawn shot landed on; 255 (none) until the night is posted AND sealed
    uint16 hits;
    uint32 shots;
    uint8 tier; // 0 none, 1 Common .. 5 Legendary
    uint8 reach; // 0 not known, 1 in reach, 2 out of reach tonight (never catches: landings there are chip noise)
    uint8 steps; // the walk's steps that night (0 until a ran night is posted)
    uint8 start; // his start: the ring turn, turns % 16 (0 until a ran night is posted)
    uint8 firstShot; // the spot the chip's very first shot landed on (0 until a ran night is posted)
    uint8 rank; // the spot's rank among the night's catchable spots by landings, 1 = most (0 = not catchable)
    uint8 catchable; // how many spots were catchable that night (0 until a ran night is posted)
    uint256 counts; // the night's 16 per-spot landings, 16 bits each (0 while waiting)
    bytes32 jobId;
    bytes32 sha; // sha256 of the result file the counts come from
    uint64 seedBlock; // the block whose hash sealed the night's draws (0 until sealed)
    bytes32 seed; // the night's draw seed (0 until sealed)
}

/// The FAIR raw draw of one net (QuantumCatchV3.dnaOf): only numbers the chip and the seal decided. How they look
/// (skin, items, names, art) is the renderer's business: IS2Renderer.itemsOf maps this to item ids.
/// All zero unless the net caught (status 1). Slot k = 1..10 is index k - 1: 1 Face, 2 Head, 3 Eyes, 4 Mouth, 5 Neck,
/// 6 Hands, 7 Back, 8 Special, 9 Aura, 10 Background.
struct Dna {
    uint8 status; // as Card.status
    uint8 tier; // the main draw's tier (1 Common .. 5 Legendary)
    uint8 spot; // the main draw's spot
    uint32 shots; // the night's shots (the modulus of every draw)
    bytes32 word; // w0 = keccak256(abi.encode(night, seed, tokenId)): the main draw (landing = w0 % shots)
    uint8[10] tiers; // per slot: the tier of the spot its own shot landed on (0 got away/noise .. 5)
    uint8[10] spots; // per slot: the spot its shot landed on
    uint32[10] landings; // per slot: its shot, wk % shots (an index into the night's shots, spots in order)
    bytes32[10] words; // per slot: wk = keccak256(abi.encode(night, seed, tokenId, uint256 k))
}

/// What QuantumCatchV3 needs from a Season 2 renderer (set by its owner until lock()).
interface IS2Renderer {
    /// the full ERC-721 metadata URI ("data:application/json;base64,..."); QuantumCatchV3.tokenURI returns the
    /// renderer's returndata as is, so this must return exactly the ABI encoding of one string
    function tokenURI(Card calldata c, Dna calldata d) external view returns (string memory);

    /// the caught hamster's looks: skin id and per slot k (index k - 1) the item id shown (0 = the slot's default);
    /// all 0 unless d.status is 1
    function itemsOf(Dna calldata d) external view returns (uint8 skin, uint8[10] memory items);
}
