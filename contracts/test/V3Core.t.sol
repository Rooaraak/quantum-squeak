// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {V3Base, MockRenderer, RevertingRenderer} from "./V3Base.t.sol";
import {QuantumCatchV3, ISqk} from "../src/QuantumCatchV3.sol";
import {Card, Dna, IS2Renderer} from "../src/S2Types.sol";

contract V3DeployTest is V3Base {
    function test_names_and_owner() public view {
        assertEq(qc.name(), "Quantum Catch Season 2");
        assertEq(qc.symbol(), "QCATCH2");
        assertEq(qc.owner(), address(this), "the deployer owns it");
        assertFalse(qc.locked());
        assertEq(address(qc.renderer()), address(mock));
        assertEq(qc.HATCHER(), hatcher);
    }

    function test_constructor_checks() public {
        vm.expectRevert(QuantumCatchV3.ZeroHatcher.selector);
        new QuantumCatchV3(address(0), mock, ISqk(address(0)), 0);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.RendererHasNoCode.selector, alice));
        new QuantumCatchV3(hatcher, IS2Renderer(alice), ISqk(address(0)), 0);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.BadNetCost.selector, 1));
        new QuantumCatchV3(hatcher, mock, ISqk(address(0)), 1);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.SqkHasNoCode.selector, bob));
        new QuantumCatchV3(hatcher, mock, ISqk(bob), 1);
    }

    function test_interfaces() public view {
        assertTrue(qc.supportsInterface(0x01ffc9a7));
        assertTrue(qc.supportsInterface(0x80ac58cd));
        assertTrue(qc.supportsInterface(0x5b5e139f));
        assertTrue(qc.supportsInterface(0x49064906));
        assertFalse(qc.supportsInterface(0xffffffff));
    }
}

contract V3SealTest is V3Base {
    event NightSealed(uint32 indexed night, uint256 seedBlock, bytes32 blockHash, bytes32 seed);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    function test_seal_before_post_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NotPosted.selector, N1104));
        qc.seal(N1104);
    }

    function test_seal_needs_two_blocks_after_the_post() public {
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        (uint64 pb, uint64 sb, bytes32 seed) = qc.sealOf(N1104);
        assertEq(pb, POST_BLOCK);
        assertEq(sb, 0);
        assertEq(seed, bytes32(0));
        // in the post's block and the next one: the hash of block P + 1 does not exist yet
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.SealTooEarly.selector, N1104, POST_BLOCK + 2));
        qc.seal(N1104);
        vm.roll(POST_BLOCK + 1);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.SealTooEarly.selector, N1104, POST_BLOCK + 2));
        qc.seal(N1104);
        vm.roll(POST_BLOCK + 2);
        vm.setBlockhash(POST_BLOCK + 1, BH);
        bytes32 want = keccak256(abi.encode(BH, SHA_1104, JOB_1104));
        vm.expectEmit(address(qc));
        emit NightSealed(N1104, POST_BLOCK + 1, BH, want);
        vm.expectEmit(address(qc));
        emit BatchMetadataUpdate(uint256(N1104) << 160, (uint256(N1104) << 160) | type(uint160).max);
        assertEq(qc.seal(N1104), want);
        (, sb, seed) = qc.sealOf(N1104);
        assertEq(sb, POST_BLOCK + 1);
        assertEq(seed, want);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.AlreadySealed.selector, N1104));
        qc.seal(N1104);
    }

    function test_seal_uses_block_p_plus_1_through_257_blocks_later() public {
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        vm.roll(POST_BLOCK + 1 + 256); // the last block in which blockhash(P + 1) still exists
        vm.setBlockhash(POST_BLOCK + 1, BH);
        assertEq(qc.seal(N1104), keccak256(abi.encode(BH, SHA_1104, JOB_1104)));
        (, uint64 sb,) = qc.sealOf(N1104);
        assertEq(sb, POST_BLOCK + 1);
    }

    /// (no EIP-2935 contract here: at P + 258 the newest P + 1 + 256 k is P + 257, the block before; V3SealLate.t.sol
    /// has the history contract and the other points)
    function test_late_seal_without_history_uses_the_newest_256_block_boundary() public {
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        uint256 now_ = POST_BLOCK + 1 + 257; // blockhash(P + 1) is gone
        vm.roll(now_);
        bytes32 late = keccak256("late block");
        vm.setBlockhash(now_ - 1, late);
        assertEq(qc.seal(N1104), keccak256(abi.encode(late, SHA_1104, JOB_1104)));
        (, uint64 sb,) = qc.sealOf(N1104);
        assertEq(sb, now_ - 1);
    }

    function test_anyone_can_seal() public {
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        vm.roll(POST_BLOCK + 2);
        vm.setBlockhash(POST_BLOCK + 1, BH);
        vm.prank(carol);
        qc.seal(N1104);
        (, uint64 sb,) = qc.sealOf(N1104);
        assertEq(sb, POST_BLOCK + 1);
    }

    function test_the_seal_decides_the_draws() public {
        uint256 id = _cast(alice);
        _post(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, FIRST_1104_V12, JOB_1104, SHA_1104);
        (uint8 status,, uint8 spot,,,,) = qc.result(id);
        assertEq(status, qc.DRAWING());
        assertEq(spot, 255, "nothing drawn before the seal");
        Dna memory d0 = qc.dnaOf(id);
        assertEq(d0.status, 5);
        assertEq(d0.word, bytes32(0));
        bytes32 seed = _sealNow(N1104);
        (status,, spot,,,,) = qc.result(id);
        assertEq(spot, _refDraw(N1104, seed, id, _counts1104v12()), "the main draw is keccak(night, seed, id)");
        assertTrue(status == 1 || status == 2);
    }

    function test_slept_night_reads_slept_sealed_or_not() public {
        uint256 id = _cast(alice);
        uint16[16] memory none;
        _post(N1104, none, 0, 0, 0, JOB_1104, SHA_1104);
        (uint8 status,, uint8 spot,,,,) = qc.result(id);
        assertEq(status, 3);
        assertEq(spot, 255);
        _sealNow(N1104);
        (status,, spot,,,,) = qc.result(id);
        assertEq(status, 3);
        assertEq(qc.dnaOf(id).status, 3);
    }
}

contract V3StatesTest is V3Base {
    function test_every_status() public {
        uint256 w = _cast(alice);
        (uint8 status, uint32 night, uint8 spot,, uint32 shots,,) = qc.result(w);
        assertEq(status, 0);
        assertEq(night, N1104);
        assertEq(spot, 255);
        assertEq(shots, 0);
        (uint32 n_, bool drawn, bool caught,,,,) = qc.traitsOf(w);
        assertEq(n_, N1104);
        assertFalse(drawn);
        assertFalse(caught);
        // no chip result after the window
        vm.warp(qc.postDeadline(N1104));
        (status,,,,,,) = qc.result(w);
        assertEq(status, 4);
        assertEq(qc.dnaOf(w).status, 4);
    }

    function test_caught_and_got_away_agree_everywhere() public {
        uint16[16] memory c = _counts1104v12();
        uint256 caughtId = _castOn(13, c); // 578: in reach (odd), Common
        uint256 awayId = _castOn(0, c); // 40: even, out of reach (noise)
        bytes32 seed = _post1104(c, FIRST_1104_V12);
        _checkCaught(caughtId, seed, c);
        _checkTraits(caughtId);
        _checkAway(awayId, seed, c);
        assertEq(qc.drawOf(N1104, seed, caughtId, c), 13);
        assertEq(qc.drawOf(N1104, seed, awayId, c), 0);
    }

    function _checkCaught(uint256 id, bytes32 seed, uint16[16] memory c) internal view {
        uint8[16] memory tiers = _refTiers(c, TURNS_1104, STEPS_V12, FIRST_1104_V12);
        uint8 tier = _checkResult(id, tiers[13]);
        Dna memory d = qc.dnaOf(id);
        assertEq(d.status, 1);
        assertEq(d.tier, tier);
        assertEq(d.spot, 13);
        assertEq(d.shots, 4000);
        assertEq(d.word, keccak256(abi.encode(N1104, seed, id)));
        for (uint256 k = 1; k <= 10; ++k) {
            bytes32 wk = keccak256(abi.encode(N1104, seed, id, k));
            assertEq(d.words[k - 1], wk);
            assertEq(d.landings[k - 1], uint256(wk) % 4000);
            uint8 s = _refWalk(c, uint256(wk));
            assertEq(d.spots[k - 1], s);
            assertEq(d.tiers[k - 1], tiers[s]);
        }
        _checkDnaFor(id, seed, c, _dnaKey(d));
    }

    /// dnaFor (pure) = dnaOf
    function _checkDnaFor(uint256 id, bytes32 seed, uint16[16] memory c, bytes32 want) internal view {
        assertEq(_dnaKey(qc.dnaFor(N1104, seed, id, c, TURNS_1104, STEPS_V12, FIRST_1104_V12)), want);
    }

    function _checkResult(uint256 id, uint8 want) internal view returns (uint8 tier) {
        (uint8 status,, uint8 spot, uint16 hits, uint32 shots, uint8 t, uint8 looks) = qc.result(id);
        assertEq(status, 1);
        assertEq(spot, 13);
        assertEq(hits, 578);
        assertEq(shots, 4000);
        assertEq(t, want);
        assertEq(looks, 0, "Season 2: looks always 0");
        assertEq(qc.reachOf(id), 1);
        return t;
    }

    function _checkTraits(uint256 id) internal view {
        (,,,,, uint8 tier,) = qc.result(id);
        (uint32 night, bool drawn, bool caught, uint8 sp, uint8 t, uint8 skin, uint8[10] memory slots) = qc.traitsOf(id);
        assertEq(night, N1104);
        assertTrue(drawn);
        assertTrue(caught);
        assertEq(sp, 13);
        assertEq(t, tier);
        (uint8 skin2, uint8[10] memory items) = mock.itemsOf(qc.dnaOf(id));
        assertEq(skin, skin2);
        for (uint256 k; k < 10; ++k) {
            assertEq(slots[k], items[k], "traitsOf = renderer.itemsOf(dnaOf)");
        }
    }

    function _checkAway(uint256 id, bytes32 seed, uint16[16] memory c) internal view {
        (uint8 status,, uint8 spot,,, uint8 tier,) = qc.result(id);
        assertEq(status, 2);
        assertEq(spot, 0);
        assertEq(tier, 0);
        assertEq(qc.reachOf(id), 2);
        Dna memory a = qc.dnaOf(id);
        assertEq(a.status, 2);
        assertEq(a.word, bytes32(0), "no DNA unless caught");
        (, bool drawn, bool caught, uint8 sp,, uint8 skin,) = qc.traitsOf(id);
        assertTrue(drawn);
        assertFalse(caught);
        assertEq(sp, 0);
        assertEq(skin, 0);
        assertEq(qc.dnaFor(N1104, seed, id, c, TURNS_1104, STEPS_V12, FIRST_1104_V12).status, 2);
    }

    function test_burned_net_reverts_everywhere() public {
        uint256 id = _cast(alice);
        vm.prank(alice);
        qc.burn(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NonexistentToken.selector, id));
        qc.dnaOf(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NonexistentToken.selector, id));
        qc.tokenURI(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.AlreadyCast.selector, N1104, alice));
        _cast(alice);
    }
}

contract V3OwnerTest is V3Base {
    event RendererSet(address indexed previous, address indexed renderer);
    event Locked(address indexed by, address renderer);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    function test_only_the_owner_sets_the_renderer() public {
        MockRenderer r2 = new MockRenderer("two");
        vm.prank(alice);
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.setRenderer(r2);
        vm.prank(hatcher);
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.setRenderer(r2);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.RendererHasNoCode.selector, bob));
        qc.setRenderer(IS2Renderer(bob));
        vm.expectEmit(address(qc));
        emit RendererSet(address(mock), address(r2));
        vm.expectEmit(address(qc));
        emit BatchMetadataUpdate(0, type(uint256).max);
        qc.setRenderer(r2);
        assertEq(address(qc.renderer()), address(r2));
    }

    function test_lock_is_final() public {
        vm.prank(alice);
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.lock();
        vm.expectEmit(address(qc));
        emit Locked(address(this), address(mock));
        qc.lock();
        assertTrue(qc.locked());
        assertEq(qc.owner(), address(0));
        MockRenderer r2 = new MockRenderer("two");
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.setRenderer(r2);
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.lock();
        // address(0) can never act: nothing sends from it
        vm.prank(address(0));
        vm.expectRevert(QuantumCatchV3.NotOwner.selector);
        qc.setRenderer(r2);
        assertEq(address(qc.renderer()), address(mock));
    }

    function test_owner_has_no_other_power() public {
        uint256 id = _cast(alice);
        // the owner cannot post, move, burn or approve someone's net
        vm.expectRevert(QuantumCatchV3.NotHatcher.selector);
        qc.postNight(N1104, _counts1104v12(), TURNS_1104, STEPS_V12, JOB_1104, SHA_1104, FIRST_1104_V12);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NotOwnerNorApproved.selector, address(this), id));
        qc.burn(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NotOwnerNorApproved.selector, address(this), id));
        qc.transferFrom(alice, bob, id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatchV3.NotOwnerNorApproved.selector, address(this), id));
        qc.approve(bob, id);
    }

    /// the draw never reads the renderer: every fairness function answers the same before and after a swap
    function test_fairness_identical_across_a_renderer_swap() public {
        uint16[16] memory c = _counts1104v12();
        uint256[8] memory ids;
        for (uint256 i; i < 8; ++i) {
            ids[i] = _cast(address(uint160(0xA11CE0 + i)));
        }
        _post1104(c, FIRST_1104_V12);
        bytes32[8] memory before;
        for (uint256 i; i < 8; ++i) {
            before[i] = _fair(ids[i]);
        }
        bytes32 rec0 = _rec(N1104);
        (uint64 pb, uint64 sb, bytes32 seed) = qc.sealOf(N1104);
        string memory uri0 = qc.tokenURI(ids[0]);

        qc.setRenderer(new MockRenderer("two"));
        for (uint256 i; i < 8; ++i) {
            assertEq(_fair(ids[i]), before[i], "the draw does not depend on the renderer");
        }
        assertEq(_rec(N1104), rec0);
        (uint64 pb2, uint64 sb2, bytes32 seed2) = qc.sealOf(N1104);
        assertEq(pb2, pb);
        assertEq(sb2, sb);
        assertEq(seed2, seed);
        assertTrue(keccak256(bytes(qc.tokenURI(ids[0]))) != keccak256(bytes(uri0)), "the picture did change");
        qc.lock();
        for (uint256 i; i < 8; ++i) {
            assertEq(_fair(ids[i]), before[i]);
        }
    }

    function _rec(uint32 n) internal view returns (bytes32) {
        (bool posted, uint16[16] memory c, uint32 shots, uint32 turns, uint8 rt, uint8 steps, bytes32 j, bytes32 s, uint8 f) =
            qc.nightRecord(n);
        return keccak256(abi.encode(posted, c, shots, turns, rt, steps, j, s, f));
    }

    function _fair(uint256 id) internal view returns (bytes32) {
        return keccak256(abi.encode(_fairResult(id), _fairTraits(id), qc.spotOf(id), qc.reachOf(id), _dnaKey(qc.dnaOf(id)), qc.ownerOf(id)));
    }

    function _fairResult(uint256 id) internal view returns (bytes32) {
        (uint8 st, uint32 n, uint8 sp, uint16 h, uint32 sh, uint8 t, uint8 l) = qc.result(id);
        return keccak256(abi.encode(st, n, sp, h, sh, t, l));
    }

    /// traitsOf without the item ids (those are the renderer's: they may change)
    function _fairTraits(uint256 id) internal view returns (bytes32) {
        (uint32 n2, bool drawn, bool caught, uint8 sp2, uint8 t2,,) = qc.traitsOf(id);
        return keccak256(abi.encode(n2, drawn, caught, sp2, t2));
    }

    /// tokenURI returns the renderer's answer byte for byte, the same as decoding and re-encoding it
    function test_tokenURI_passes_the_renderer_answer_through() public {
        uint256 id = _cast(alice);
        _post1104(_counts1104v12(), FIRST_1104_V12);
        (bool ok, bytes memory raw) = address(qc).staticcall(abi.encodeCall(QuantumCatchV3.tokenURI, (id)));
        assertTrue(ok);
        (Card memory c, Dna memory d) = (_cardOf(id), qc.dnaOf(id));
        (bool ok2, bytes memory raw2) = address(mock).staticcall(abi.encodeCall(IS2Renderer.tokenURI, (c, d)));
        assertTrue(ok2);
        assertEq(raw, raw2, "returndata as is");
        assertEq(raw, abi.encode(abi.decode(raw2, (string))), "the same as decoded and re-encoded");
    }

    function test_a_failing_renderer_fails_tokenURI_only() public {
        uint256 id = _cast(alice);
        _post1104(_counts1104v12(), FIRST_1104_V12);
        bytes32 f = _fair(id);
        qc.setRenderer(new RevertingRenderer());
        vm.expectRevert(QuantumCatchV3.RendererFailed.selector);
        qc.tokenURI(id);
        (uint8 st,,,,,,) = qc.result(id);
        if (st == 1) {
            vm.expectRevert(); // traitsOf asks the renderer for the item ids
            qc.traitsOf(id);
        }
        assertEq(qc.dnaOf(id).status, st, "the draw still reads");
        qc.setRenderer(mock);
        assertEq(_fair(id), f);
    }

    /// what the game hands its renderer for a net (rebuilt from the views, independently of _cardDna)
    function _cardOf(uint256 id) internal view returns (Card memory c) {
        (c.status, c.night, c.spot, c.hits, c.shots, c.tier,) = qc.result(id);
        c.reach = qc.reachOf(id);
        _nightInto(c);
        (, c.seedBlock, c.seed) = qc.sealOf(c.night);
        _rankInto(c);
    }

    function _nightInto(Card memory c) internal view {
        (, uint16[16] memory counts,,, uint8 ringTurn, uint8 steps, bytes32 job, bytes32 sha, uint8 first) =
            qc.nightRecord(c.night);
        c.steps = steps;
        c.start = ringTurn;
        c.firstShot = first;
        c.counts = _pack(counts);
        c.jobId = job;
        c.sha = sha;
    }

    function _pack(uint16[16] memory counts) internal pure returns (uint256 packed) {
        for (uint256 i; i < 16; ++i) {
            packed |= uint256(counts[i]) << (16 * i);
        }
    }

    /// rank and catchable, from the night's tiers
    function _rankInto(Card memory c) internal view {
        (, uint16[16] memory counts,,,,,,,) = qc.nightRecord(c.night);
        uint8[16] memory tiers = _refTiers(counts, TURNS_1104, c.steps, c.firstShot);
        uint256 n_;
        uint256 rank;
        uint8 sp = c.spot;
        for (uint256 s; s < 16; ++s) {
            if (tiers[s] == 0) continue;
            ++n_;
            if (counts[s] > counts[sp] || (counts[s] == counts[sp] && s < sp)) ++rank;
        }
        c.catchable = uint8(n_);
        c.rank = tiers[sp] == 0 ? 0 : uint8(rank + 1);
    }
}

/// v2's faucet works with v3 (it calls only the pure openNightAt): the Season 1 clock, byte for byte
contract V3ClockTest is V3Base {
    address internal v2;

    function setUp() public override {
        super.setUp();
        // v2's source is still in the repo: deploy it next to v3 and compare
        v2 = deployCode("QuantumCatch.sol:QuantumCatch", abi.encode(hatcher, address(0), address(0), 0));
    }

    function testFuzz_clock_is_v2s(uint256 t) public view {
        QuantumCatchV3 v3 = qc;
        (bool ok2, bytes memory r2) = v2.staticcall(abi.encodeWithSignature("openNightAt(uint256)", t));
        (bool ok3, bytes memory r3) = address(v3).staticcall(abi.encodeWithSignature("openNightAt(uint256)", t));
        assertEq(ok2, ok3);
        assertEq(r2, r3);
        (ok2, r2) = v2.staticcall(abi.encodeWithSignature("nightOf(uint256)", t));
        (ok3, r3) = address(v3).staticcall(abi.encodeWithSignature("nightOf(uint256)", t));
        assertEq(ok2, ok3);
        assertEq(r2, r3);
    }

    function testFuzz_clock_at_times_near_the_turns(uint32 n, uint8 which) public view {
        uint256 t = uint256(n) * 86400 + 43200 + [0, 32399, 32400, 32401, 86399][which % 5];
        (, bytes memory r2) = v2.staticcall(abi.encodeWithSignature("openNightAt(uint256)", t));
        (, bytes memory r3) = address(qc).staticcall(abi.encodeWithSignature("openNightAt(uint256)", t));
        assertEq(r2, r3);
    }

    function test_clock_constants() public view {
        string[3] memory names = ["DAY()", "DAY_OFFSET()", "LOCK()"];
        for (uint256 i; i < 3; ++i) {
            (, bytes memory a) = v2.staticcall(abi.encodeWithSignature(names[i]));
            (, bytes memory b) = address(qc).staticcall(abi.encodeWithSignature(names[i]));
            assertEq(a, b, names[i]);
        }
    }
}
