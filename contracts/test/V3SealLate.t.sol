// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V3Base, MockRenderer} from "./V3Base.t.sol";
import {QuantumCatchV3} from "../src/QuantumCatchV3.sol";
import {Card, Dna, IS2Renderer} from "../src/S2Types.sol";

/// The late seal (the review's R1, 7 Nov). Block P + 1's hash seals a night posted in block P: from BLOCKHASH to block
/// P + 257, then from the EIP-2935 history contract to P + 8192; only later the newest block P + 1 + 256 k. Forge runs
/// no system calls, so the tests put the history contract (its real Sepolia runtime) and the hashes it would hold in
/// place with vm.etch / vm.store.
abstract contract HistoryBase is V3Base {
    address internal constant HISTORY = 0x0000F90827F1C53a10cb7A02335B175320002935;
    /// eth_getCode of the EIP-2935 contract on Sepolia (7 Nov 2026): the standard system contract
    bytes internal constant HISTORY_CODE =
        hex"3373fffffffffffffffffffffffffffffffffffffffe14604657602036036042575f35600143038111604257611fff81430311604257611fff9006545f5260205ff35b5f5ffd5b5f35611fff60014303065500";
    uint256 internal constant T = POST_BLOCK + 1; // the block whose hash seals the night

    function _history(uint256 b, bytes32 h) internal {
        if (HISTORY.code.length == 0) vm.etch(HISTORY, HISTORY_CODE);
        vm.store(HISTORY, bytes32(b % 8191), h);
    }

    function _canon() internal pure returns (bytes32) {
        return keccak256(abi.encode(BH, SHA_1104, JOB_1104));
    }

    function _postNow() internal returns (uint32 n) {
        n = N1104;
        _post(n, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
    }

    /// seal at block x (the history holding BH for T when `history`), with block b's hash bb for the late source
    function _sealAt(uint32 n, uint256 x, bool history) internal returns (uint64 sb, bytes32 seed) {
        vm.roll(x);
        if (x - T <= 256) vm.setBlockhash(T, BH);
        if (history) _history(T, BH);
        seed = qc.seal(n);
        (, sb,) = qc.sealOf(n);
    }
}

contract V3SealPointsTest is HistoryBase {
    function _point(uint256 x, bool history) internal returns (uint64 sb, bytes32 seed) {
        uint256 snap = vm.snapshotState();
        uint32 n = _postNow();
        // the late source's blocks get a recognizable hash
        uint256 b = T + 256 * ((x - 1 - T) / 256);
        vm.roll(x);
        if (x - 1 - b < 256 && b != T) vm.setBlockhash(b, keccak256(abi.encode("late", b)));
        (sb, seed) = _sealAt(n, x, history);
        vm.revertToState(snap);
    }

    function test_P_plus_2_and_P_plus_257_use_blockhash() public {
        (uint64 sb, bytes32 seed) = _point(POST_BLOCK + 2, false);
        assertEq(sb, T);
        assertEq(seed, _canon());
        (sb, seed) = _point(POST_BLOCK + 257, false);
        assertEq(sb, T, "P + 257: block P + 1 is the 256th block back: BLOCKHASH still has it");
        assertEq(seed, _canon());
    }

    function test_P_plus_258_to_P_plus_8192_use_the_history_same_seed() public {
        uint256[4] memory xs = [POST_BLOCK + 258, POST_BLOCK + 1000, POST_BLOCK + 5000, POST_BLOCK + 8192];
        for (uint256 i; i < 4; ++i) {
            (uint64 sb, bytes32 seed) = _point(xs[i], true);
            assertEq(sb, T, "block P + 1 from the EIP-2935 history");
            assertEq(seed, _canon(), "the same seed as a seal in time");
        }
    }

    function test_P_plus_8193_and_P_plus_8194_use_the_newest_256_block_boundary() public {
        // P + 8193: the history no longer has P + 1 (8192 back); the newest P + 1 + 256 k below it is P + 1 + 7936
        (uint64 sb, bytes32 seed) = _point(POST_BLOCK + 8193, true);
        assertEq(sb, T + 7936);
        assertEq(seed, keccak256(abi.encode(keccak256(abi.encode("late", T + 7936)), SHA_1104, JOB_1104)));
        // P + 8194: P + 1 + 8192 = P + 8193 is now a boundary (the block just before)
        (sb, seed) = _point(POST_BLOCK + 8194, true);
        assertEq(sb, T + 8192);
        assertEq(seed, keccak256(abi.encode(keccak256(abi.encode("late", T + 8192)), SHA_1104, JOB_1104)));
    }

    function test_without_the_history_contract_the_boundary_rule_starts_at_P_plus_258() public {
        (uint64 sb,) = _point(POST_BLOCK + 258, false);
        assertEq(sb, T + 256, "a chain without EIP-2935: P + 257 is the newest boundary");
        (sb,) = _point(POST_BLOCK + 513, false);
        assertEq(sb, T + 256);
        (sb,) = _point(POST_BLOCK + 514, false);
        assertEq(sb, T + 512);
    }

    function test_sealBlockFor_says_which_block_a_seal_would_use() public {
        _postNow();
        _history(T, BH);
        vm.roll(POST_BLOCK + 1);
        assertEq(qc.sealBlockFor(POST_BLOCK), 0, "too early");
        vm.roll(POST_BLOCK + 300);
        assertEq(qc.sealBlockFor(POST_BLOCK), T);
        uint256 x = POST_BLOCK + 9000;
        vm.roll(x);
        assertEq(qc.sealBlockFor(POST_BLOCK), T + 256 * ((x - 1 - T) / 256)); // P + 1 + 8960 (integer division)
        assertEq(qc.sealBlockFor(POST_BLOCK), T + 8960);
    }

    /// the review's fuzz, on the new rule: whoever seals, whenever, the seed is block P + 1's to P + 8192, then one per
    /// 256 blocks; nothing the owner does moves it
    function testFuzz_review_seal_window(uint256 k, address sealer, bytes32 hLate) public {
        k = bound(k, 2, 20_000);
        uint256 id = _cast(alice);
        uint32 n = uint32(id >> 160);
        _post(n, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        uint256 x = POST_BLOCK + k;
        vm.roll(x);
        if (x - T <= 256) vm.setBlockhash(T, BH);
        _history(T, BH);
        uint256 b = T + 256 * ((x - 1 - T) / 256);
        if (b != T) vm.setBlockhash(b, hLate);
        vm.prank(sealer);
        bytes32 seed = qc.seal(n);
        (, uint64 sb, bytes32 stored) = qc.sealOf(n);
        assertEq(seed, stored);
        if (k <= 8192) {
            assertEq(sb, T, "to P + 8192: block P + 1");
            assertEq(seed, _canon());
        } else {
            assertEq(sb, b, "later: the newest P + 1 + 256 k");
            assertEq(seed, keccak256(abi.encode(hLate, SHA_1104, JOB_1104)));
        }
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.AlreadySealed.selector, n));
        qc.seal(n);
        qc.setRenderer(new MockRenderer("other"));
        qc.lock();
        (, uint64 sb2, bytes32 stored2) = qc.sealOf(n);
        assertEq(sb2, sb);
        assertEq(stored2, stored);
    }
}

/// the review's exploit, as a regression: a caster who simulates the seal block by block for its own net
contract V3LateSealGrindTest is HistoryBase {
    function _golden() internal view returns (uint8 first) {
        uint8[16] memory tiers = qc.tiersOf(_counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12);
        for (uint8 s; s < 16; ++s) {
            if (tiers[s] == 4) first = s;
        }
    }

    /// inside the history window the grind finds nothing to choose: every block's seal is the in-time seal
    function test_review_grind_fails_inside_the_8191_block_window() public {
        uint256 id = _cast(alice);
        uint32 n = uint32(id >> 160);
        uint8 first = _golden();
        _post(n, _counts1104v12(), TURNS_1104, STEPS_V12, first, JOB_1104, SHA_1104);
        _history(T, BH);
        uint8 canonTier = qc.dnaFor(n, _canon(), id, _counts1104v12(), TURNS_1104, STEPS_V12, first).tier;
        // every block from P + 258 (where the old rule let the sealer pick) to the end of the window: the same block
        for (uint256 x = POST_BLOCK + 258; x <= POST_BLOCK + 8192; x += 7) {
            vm.roll(x);
            assertEq(qc.sealBlockFor(POST_BLOCK), T);
        }
        // and real seals at a spread of blocks: always the canonical seed and tier
        for (uint256 x = POST_BLOCK + 258; x <= POST_BLOCK + 8192; x += 997) {
            uint256 snap = vm.snapshotState();
            vm.roll(x);
            vm.prank(alice);
            bytes32 seed = qc.seal(n);
            assertEq(seed, _canon());
            (,,,,, uint8 tier,) = qc.result(id);
            assertEq(tier, canonTier, "the late sealer gets the in-time tier");
            vm.revertToState(snap);
        }
    }

    /// after the window a late sealer still chooses, but only once per 256 blocks: over 2,000 blocks of waiting, 8 or 9
    /// seeds instead of 2,000
    function test_review_grind_after_the_window_gets_one_choice_per_256_blocks() public {
        _cast(alice);
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, _golden(), JOB_1104, SHA_1104);
        uint256 distinct;
        uint256 last;
        for (uint256 x = POST_BLOCK + 8193; x < POST_BLOCK + 8193 + 2000; ++x) {
            vm.roll(x);
            uint256 b = qc.sealBlockFor(POST_BLOCK);
            assertEq((b - T) % 256, 0, "a 256-block boundary");
            assertLt(x - 1 - b, 256, "BLOCKHASH still has it");
            if (b != last) {
                ++distinct;
                last = b;
            }
        }
        emit log_named_uint("seeds a late sealer could choose from over 2,000 blocks", distinct);
        assertLe(distinct, 9);
    }
}

/// a renderer that answers too short (R4): tokenURI reverts RendererFailed instead of passing junk through
contract FallbackOnlyRenderer {
    fallback() external {}
}

contract ShortRenderer {
    fallback() external {
        assembly ("memory-safe") {
            mstore(0, 0x20)
            return(0, 32)
        }
    }
}

contract V3ShortReturnTest is V3Base {
    function test_a_renderer_with_no_or_short_answer_fails() public {
        uint256 id = _cast(alice);
        qc.setRenderer(IS2Renderer(address(new FallbackOnlyRenderer())));
        vm.expectRevert(QuantumCatchV3.RendererFailed.selector);
        qc.tokenURI(id);
        qc.setRenderer(IS2Renderer(address(new ShortRenderer())));
        vm.expectRevert(QuantumCatchV3.RendererFailed.selector);
        qc.tokenURI(id);
        qc.setRenderer(mock);
        assertGt(bytes(qc.tokenURI(id)).length, 0);
    }
}
