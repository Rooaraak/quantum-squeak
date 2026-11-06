// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchBase} from "./Base.t.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";
import {CatchArt} from "../src/CatchArt.sol";

contract CatchTimeTest is CatchBase {
    function test_constructor_rejects_zero_hatcher() public {
        vm.expectRevert(QuantumCatch.ZeroHatcher.selector);
        new QuantumCatch(address(0), NO_ART, NO_SQK, 0);
    }

    function test_constructor_rejects_art_without_code() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.ArtHasNoCode.selector, alice));
        new QuantumCatch(hatcher, IPaintedArt(alice), NO_SQK, 0);
    }

    function test_art_and_renderer_are_fixed_at_deploy() public {
        assertEq(address(qc.ART()), address(0), "no painted art in the base tests");
        CatchArt r = qc.RENDERER();
        assertGt(address(r).code.length, 0, "the constructor created the renderer");
        assertEq(vm.getNonce(address(qc)), 2, "it created exactly one contract");
        QuantumCatch other = new QuantumCatch(hatcher, IPaintedArt(address(qc)), NO_SQK, 0);
        assertEq(address(other.ART()), address(qc));
        assertTrue(address(other.RENDERER()) != address(r), "each game has its own renderer");
    }

    function test_constants() public view {
        assertEq(qc.HATCHER(), hatcher);
        assertEq(qc.LOCK(), 9 hours);
        assertEq(qc.name(), "Quantum Catch");
        assertEq(qc.symbol(), "QCATCH");
    }

    function test_night_math_on_the_real_dates() public view {
        assertEq(qc.nightOf(START_1104), N1104);
        assertEq(qc.nightOf(START_1104 - 1), N1104 - 1); // 11:59:59 on 4 Nov is still the night of 3 Nov
        assertEq(qc.nightOf(OVER_1104 - 1), N1104);
        assertEq(qc.nightOf(OVER_1104), N1104 + 1);
        assertEq(qc.nightStart(N1104), START_1104);
        assertEq(qc.netsCloseAt(N1104), LOCK_1104);
        assertEq(qc.nightOverAt(N1104), OVER_1104);
    }

    function test_openNight_switches_at_the_lock() public view {
        assertEq(qc.openNightAt(START_1104), N1104);
        assertEq(qc.openNightAt(LOCK_1104 - 1), N1104);
        assertEq(qc.openNightAt(LOCK_1104), N1104 + 1); // 21:00:00: tonight is closed, nets go to tomorrow
        assertEq(qc.openNightAt(OVER_1104 - 1), N1104 + 1); // early morning: still tomorrow's night
        assertEq(qc.openNightAt(OVER_1104), N1104 + 1); // noon: the new Squeek day, its nets are open
        assertEq(qc.openNight(), N1104);
    }

    function test_time_before_the_first_night_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.TimeOutOfRange.selector, uint256(43199)));
        qc.nightOf(43199);
        assertEq(qc.nightOf(43200), 0);
    }
}

contract CastNetTest is CatchBase {
    function test_castNet_mints_to_the_caller_with_the_night_and_address_id() public {
        uint256 want = (uint256(N1104) << 160) | uint160(alice);
        vm.expectEmit(true, true, true, true, address(qc));
        emit QuantumCatch.Transfer(address(0), alice, want);
        vm.expectEmit(true, true, false, true, address(qc));
        emit QuantumCatch.NetCast(N1104, alice, want);
        uint256 id = _cast(alice);
        assertEq(id, want);
        assertEq(qc.netId(N1104, alice), want);
        assertEq(qc.ownerOf(id), alice);
        assertEq(qc.balanceOf(alice), 1);
        (uint8 status, uint32 night, uint8 spot,,,, uint8 looks) = qc.result(id);
        assertEq(status, 0);
        assertEq(night, N1104);
        assertEq(spot, 255, "no spot before the chip result: nobody picks one");
        assertEq(qc.spotOf(id), qc.NO_SPOT());
        assertEq(looks, 0);
    }

    function test_the_pick_a_spot_cast_is_gone() public {
        vm.prank(alice);
        (bool ok,) = address(qc).call(abi.encodeWithSignature("castNet(uint8)", uint8(5)));
        assertFalse(ok, "castNet(uint8) does not exist (no fallback either)");
        vm.prank(alice);
        (ok,) = address(qc).call(
            abi.encodeWithSignature(
                "castNetWithPermit(uint8,uint256,uint8,bytes32,bytes32)", uint8(5), block.timestamp, 27, 0, 0
            )
        );
        assertFalse(ok);
        assertEq(qc.balanceOf(alice), 0);
    }

    function test_lock_boundary_one_second_before_is_tonight() public {
        vm.warp(LOCK_1104 - 1);
        uint256 id = _cast(alice);
        assertEq(id >> 160, N1104);
    }

    function test_lock_boundary_exactly_at_lock_tonight_is_closed() public {
        vm.warp(LOCK_1104);
        uint256 id = _cast(alice);
        assertEq(id >> 160, N1104 + 1, "at 21:00:00 the net is for tomorrow's night");
        assertEq(qc.balanceOf(alice), 1);
        uint256 tonight = qc.netId(N1104, alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, tonight));
        qc.ownerOf(tonight);
    }

    function test_one_net_per_wallet_per_night() public {
        _cast(alice);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        _cast(alice);
        vm.warp(LOCK_1104); // next night: a new net is fine
        _cast(alice);
        assertEq(qc.balanceOf(alice), 2);
    }

    function test_one_net_per_night_survives_a_transfer() public {
        uint256 id = _cast(alice);
        vm.prank(alice);
        qc.transferFrom(alice, bob, id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, N1104, alice));
        _cast(alice); // she gave her net away: still her one net for tonight
        _cast(bob); // bob holds alice's net and may still cast his own
        assertEq(qc.balanceOf(bob), 2);
    }

    function test_hatcher_cannot_cast_a_net() public {
        vm.expectRevert(QuantumCatch.HatcherIsNotAPlayer.selector);
        _cast(hatcher);
    }

    function test_castNet_is_not_payable() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(qc).call{value: 1}(abi.encodeCall(QuantumCatch.castNet, ()));
        assertFalse(ok);
        (ok,) = address(qc).call{value: 1}("");
        assertFalse(ok, "no receive / fallback");
    }
}

contract PostNightTest is CatchBase {
    function test_only_hatcher_posts() public {
        vm.warp(OVER_1104);
        vm.prank(alice);
        vm.expectRevert(QuantumCatch.NotHatcher.selector);
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
    }

    function test_post_only_after_the_night_is_over() public {
        vm.warp(OVER_1104 - 1);
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NightNotOver.selector, N1104, OVER_1104));
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        vm.warp(OVER_1104);
        _post(N1104, _counts1104(), TURNS_1104);
    }

    function test_post_once_per_night() public {
        _post1104();
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyPosted.selector, N1104));
        qc.postNight(N1104, _counts1104(), TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, FIRST_1104);
        uint16[16] memory zero;
        vm.prank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyPosted.selector, N1104));
        qc.postNight(N1104, zero, 0, 0, 0, 0, 0);
    }

    function test_slept_night_must_have_no_landings() public {
        vm.warp(OVER_1104);
        uint16[16] memory c;
        c[3] = 1;
        vm.prank(hatcher);
        vm.expectRevert(QuantumCatch.SleptButLandings.selector);
        qc.postNight(N1104, c, 0, 0, 0, 0, 0);
    }

    function test_running_night_must_have_landings() public {
        vm.warp(OVER_1104);
        uint16[16] memory c;
        vm.prank(hatcher);
        vm.expectRevert(QuantumCatch.NoLandings.selector);
        qc.postNight(N1104, c, 5, 5, JOB_1104, SHA_1104, 0);
    }

    /// the first shot is a spot the chip landed on (it is one of the night's shots), and 0 when he slept
    function test_first_shot_must_be_a_landing() public {
        vm.warp(OVER_1104);
        uint16[16] memory c = _counts1104();
        uint16[16] memory zero;
        vm.startPrank(hatcher);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadFirstShot.selector, uint8(16)));
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, 16);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadFirstShot.selector, uint8(255)));
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, 255);
        c[4] = 0;
        c[5] += 25;
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadFirstShot.selector, uint8(4)));
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, 4); // no landing on spot 4
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadFirstShot.selector, uint8(3)));
        qc.postNight(N1104, zero, 0, 0, 0, 0, 3); // he slept: no shots at all
        qc.postNight(N1104, c, TURNS_1104, STEPS_1104, JOB_1104, SHA_1104, 0); // spot 0 has 27 landings: fine
        vm.stopPrank();
        (,,,,,,,, uint8 first) = qc.nightRecord(N1104);
        assertEq(first, 0);
    }

    function test_post_stores_the_record_and_emits() public {
        vm.warp(OVER_1104);
        vm.expectEmit(true, false, false, true, address(qc));
        emit QuantumCatch.NightPosted(N1104, 4000, TURNS_1104, JOB_1104, SHA_1104, FIRST_1104);
        vm.expectEmit(false, false, false, true, address(qc));
        emit QuantumCatch.BatchMetadataUpdate(uint256(N1104) << 160, (uint256(N1104) << 160) | type(uint160).max);
        _postF(N1104, _counts1104(), TURNS_1104, STEPS_1104, FIRST_1104);
        (
            bool posted,
            uint16[16] memory c,
            uint32 shots,
            uint32 turns,
            uint8 ringTurn,
            uint8 steps,
            bytes32 job,
            bytes32 sha,
            uint8 first
        ) = qc.nightRecord(N1104);
        assertTrue(posted);
        uint16[16] memory want = _counts1104();
        for (uint256 i; i < 16; ++i) {
            assertEq(c[i], want[i]);
        }
        assertEq(shots, 4000);
        assertEq(turns, TURNS_1104);
        assertEq(ringTurn, 9); // 3817 % 16
        assertEq(steps, STEPS_1104);
        assertEq(job, JOB_1104);
        assertEq(sha, SHA_1104);
        assertEq(first, FIRST_1104);
    }

    function test_unposted_record_is_empty() public view {
        (bool posted,, uint32 shots,,,,,,) = qc.nightRecord(N1104);
        assertFalse(posted);
        assertEq(shots, 0);
    }

    function test_max_counts_do_not_overflow_shots() public {
        vm.warp(OVER_1104);
        uint16[16] memory c;
        for (uint256 i; i < 16; ++i) {
            c[i] = type(uint16).max;
        }
        _post(N1104, c, type(uint32).max);
        (,, uint32 shots, uint32 turns, uint8 ringTurn,,,,) = qc.nightRecord(N1104);
        assertEq(shots, 16 * uint32(type(uint16).max));
        assertEq(turns, type(uint32).max);
        assertEq(ringTurn, 15);
    }

    function test_a_later_night_can_be_posted_before_an_earlier_one() public {
        vm.warp(OVER_1104 + 86400);
        _post(N1104 + 1, _counts1104(), 1);
        _post(N1104, _counts1104(), 2);
    }
}

contract ResultTest is CatchBase {
    function test_waiting_for_the_chip() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104 + 10 days); // night long over, nothing posted yet
        (uint8 status, uint32 night, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks) = qc.result(id);
        assertEq(status, 0);
        assertEq(night, N1104);
        assertEq(spot, 255, "nothing drawn yet");
        assertEq(hits, 0);
        assertEq(shots, 0);
        assertEq(tier, 0);
        assertEq(looks, 0);
    }

    function test_real_night_caught_and_got_away() public {
        uint16[16] memory c4 = _counts1104();
        uint256 a = _castOn(15, c4); // its shot on 15: 808 / 4000 = 20.2 %: Common
        uint256 b = _castOn(5, c4); // on 5: 308 / 4000 = 7.7 %: Uncommon
        uint256 c = _castOn(0, c4); // on 0: 27 / 4000 = 0.675 %, out of reach: got away
        _post1104();
        (uint8 status,, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks) = qc.result(a);
        assertEq(status, 1);
        assertEq(spot, 15);
        assertEq(hits, 808);
        assertEq(shots, 4000);
        assertEq(tier, 1);
        assertEq(looks, 15);
        (status,, spot, hits,, tier, looks) = qc.result(b);
        assertEq(status, 1);
        assertEq(spot, 5);
        assertEq(hits, 308);
        assertEq(tier, 2);
        assertEq(looks, 5);
        (status,, spot, hits,, tier, looks) = qc.result(c);
        assertEq(status, 2);
        assertEq(spot, 0, "the shot's spot is shown when the hamster got away too");
        assertEq(hits, 27);
        assertEq(tier, 0);
        assertEq(looks, 0, "no hamster, no looks");
    }

    function test_he_slept() public {
        uint256 id = _cast(alice);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        _post(N1104, zero, 0);
        (uint8 status,, uint8 spot, uint16 hits, uint32 shots, uint8 tier,) = qc.result(id);
        assertEq(status, 3);
        assertEq(spot, 255, "he slept: nothing drawn");
        assertEq(hits, 0);
        assertEq(shots, 0);
        assertEq(tier, 0);
    }

    function test_result_for_a_missing_net_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, uint256(123)));
        qc.result(123);
    }

    /// the 4 Nov v1.2 night (10 steps, start spot 9: the odd spots in reach, all >= 1 %), ranked by landings:
    /// 1 (679) 13 (578) 15 (525) 5 (504) Common, 3 (493) 9 (380) Uncommon, 11 (260) Rare, 7 (254) Epic
    function test_rank_rule_on_the_v12_night_of_4_nov() public view {
        uint16[16] memory c = _counts1104v12();
        uint8[16] memory t = qc.tiersOf(c, TURNS_1104, STEPS_1104_V12, FIRST_1104_V12);
        uint8[16] memory want = [uint8(0), 1, 0, 2, 0, 1, 0, 4, 0, 2, 0, 3, 0, 1, 0, 1];
        for (uint256 s; s < 16; ++s) {
            assertEq(t[s], want[s], vm.toString(s));
        }
        // its real first shot landed on spot 3 (Uncommon): no Legendary. Had it landed on spot 7, the Epic spot:
        want[7] = 5;
        t = qc.tiersOf(c, TURNS_1104, STEPS_1104_V12, 7);
        for (uint256 s; s < 16; ++s) {
            assertEq(t[s], want[s], vm.toString(s));
        }
        // a first shot out of reach (spot 0, 40 landings) changes nothing
        want[7] = 4;
        t = qc.tiersOf(c, TURNS_1104, STEPS_1104_V12, 0);
        for (uint256 s; s < 16; ++s) {
            assertEq(t[s], want[s], vm.toString(s));
        }
    }

    function test_rank_rule_small_nights_and_the_1_percent_edge() public view {
        // start 0, 2 steps: spots 14, 0, 2 in reach
        uint16[16] memory c;
        c[0] = 4000;
        assertEq(qc.tiersOf(c, 16, 2, 0)[0], 5, "n = 1 and the first shot on it: Legendary");
        c[0] = 3000;
        c[2] = 1000;
        uint8[16] memory t = qc.tiersOf(c, 16, 2, 0);
        assertEq(t[0], 3, "n = 2: the first is Rare");
        assertEq(t[2], 4, "n = 2: the last is Epic (the first shot was elsewhere)");
        assertEq(qc.tiersOf(c, 16, 2, 2)[2], 5);
        // 40 of 4000 is exactly 1 %: catchable; 39 is not
        c[0] = 3921;
        c[2] = 39;
        c[14] = 40;
        t = qc.tiersOf(c, 16, 2, 14);
        assertEq(t[2], 0, "39 / 4000: under 1 %, got away");
        assertEq(t[14], 5, "40 / 4000: catchable, the Epic spot, first shot: Legendary");
        assertEq(t[0], 3);
        // equal landings: the lower spot ranks first, so the higher one is the rarer
        c[0] = 2000;
        c[2] = 2000;
        c[14] = 0;
        t = qc.tiersOf(c, 16, 2, 0);
        assertEq(t[0], 3, "tie: spot 0 ranks first (Rare)");
        assertEq(t[2], 4, "tie: spot 2 ranks last (Epic)");
        // nothing landed: nothing to catch
        uint16[16] memory zero;
        t = qc.tiersOf(zero, 0, 0, 0);
        for (uint256 s; s < 16; ++s) {
            assertEq(t[s], 0);
        }
    }

    /// 8 catchable spots, every count distinct: 4 Common, 2 Uncommon, 1 Rare, 1 Epic; and n = 1 .. 8 in general
    function test_rank_rule_counts_per_tier_for_every_n() public view {
        for (uint256 n = 1; n <= 8; ++n) {
            uint16[16] memory c;
            for (uint256 i; i < n; ++i) {
                c[2 * i] = uint16(100 + 10 * i); // even spots, start 0, 16 steps: all even spots in reach
            }
            uint8[16] memory t = qc.tiersOf(c, 16, 16, 15); // first shot elsewhere
            uint256[6] memory per;
            for (uint256 s; s < 16; ++s) {
                ++per[t[s]];
            }
            assertEq(per[4], 1, "one Epic");
            assertEq(per[3], n >= 2 ? 1 : 0, "one Rare");
            assertEq(per[2], n >= 4 ? 2 : n - (n >= 2 ? 2 : 1), "two Uncommon");
            assertEq(per[1], n >= 4 ? n - 4 : 0, "the rest Common");
            assertEq(per[5], 0);
            assertEq(t[0], 4, "spot 0 has the fewest: Epic");
        }
    }

    /// contracts/test/data/tier-vectors.json (make_tier_vectors.py, the same file the page tests read): 710 nights, 9
    /// of them the real chip files (with their real first shot), every spot, through tiersOf
    function test_tier_vectors_through_tiersOf() public view {
        string memory j = vm.readFile("test/data/tier-vectors.json");
        uint256[] memory counts = vm.parseJsonUintArray(j, ".counts");
        uint256[] memory turns = vm.parseJsonUintArray(j, ".turns");
        uint256[] memory steps = vm.parseJsonUintArray(j, ".steps");
        uint256[] memory first = vm.parseJsonUintArray(j, ".first");
        uint256[] memory tier = vm.parseJsonUintArray(j, ".tier");
        assertGt(turns.length, 700);
        assertEq(counts.length, 16 * turns.length);
        uint256 legendary;
        for (uint256 i; i < turns.length; ++i) {
            uint16[16] memory c;
            for (uint256 s; s < 16; ++s) {
                c[s] = uint16(counts[16 * i + s]);
            }
            uint8[16] memory t = qc.tiersOf(c, uint32(turns[i]), uint8(steps[i]), uint8(first[i]));
            uint8[16] memory r = _refTiers(c, turns[i], steps[i], uint8(first[i]));
            for (uint256 s; s < 16; ++s) {
                assertEq(t[s], tier[16 * i + s], string.concat("vector ", vm.toString(i), " spot ", vm.toString(s)));
                assertEq(r[s], t[s], "the test's own reference agrees");
                if (t[s] == 5) ++legendary;
            }
        }
        assertGt(legendary, 50);
    }

    /// the 9 real chip nights with their real first shot, every spot, through postNight + result() (what a holder
    /// reads): no Legendary on any of them
    function test_tier_vectors_of_the_real_nights_through_result() public {
        string memory j = vm.readFile("test/data/tier-vectors.json");
        uint256[] memory counts = vm.parseJsonUintArray(j, ".counts");
        uint256[] memory tier = vm.parseJsonUintArray(j, ".tier");
        uint256[] memory turns = vm.parseJsonUintArray(j, ".turns");
        uint256[] memory steps = vm.parseJsonUintArray(j, ".steps");
        uint256[] memory first = vm.parseJsonUintArray(j, ".first");
        uint256[] memory real = vm.parseJsonUintArray(j, ".real");
        uint256 nights;
        for (uint256 i; i < turns.length; ++i) {
            if (real[i] != 1) continue; // 1 = the file's own first shot
            uint32 n = N1104 + 1 + uint32(nights++);
            uint16[16] memory c;
            for (uint256 s; s < 16; ++s) {
                c[s] = uint16(counts[16 * i + s]);
            }
            vm.warp(qc.nightStart(n) + 60);
            uint256[16] memory ids = _castEvery(c); // a net whose shot lands on each spot with landings
            vm.warp(qc.nightOverAt(n));
            _postF(n, c, uint32(turns[i]), uint8(steps[i]), uint8(first[i]));
            for (uint256 s; s < 16; ++s) {
                if (c[s] == 0) continue; // never drawn
                _checkNet(ids[s], s, c[s], tier[16 * i + s], string.concat("real night ", vm.toString(nights), " spot ", vm.toString(s)));
            }
        }
        assertEq(nights, 9);
    }

    function _checkNet(uint256 id, uint256 s, uint16 count, uint256 want, string memory label) internal view {
        (uint8 status,, uint8 spot, uint16 hits,, uint8 t,) = qc.result(id);
        assertEq(spot, s, label);
        assertEq(t, want, label);
        assertEq(status, t == 0 ? 2 : 1);
        assertEq(hits, count);
        assertTrue(t != 5, "no real night had its first shot on the Epic spot");
    }

    /// one night, every tier: the 4 Nov v1.2 counts with the first shot on its Epic spot 7 (made up: the real one
    /// landed on spot 3), and an in-reach net under 1 %
    function test_every_tier_through_result() public {
        uint8[6] memory spots = [uint8(1), 3, 11, 7, 0, 9];
        uint8[6] memory want = [uint8(1), 2, 3, 5, 0, 2]; // Common, Uncommon, Rare, Legendary, got away (out of reach)
        uint256[6] memory ids;
        for (uint256 k; k < 6; ++k) {
            ids[k] = _castOn(spots[k], _counts1104v12());
        }
        vm.warp(OVER_1104);
        _postF(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12, 7);
        for (uint256 k; k < 6; ++k) {
            (uint8 status,, uint8 spot,,, uint8 tier,) = qc.result(ids[k]);
            assertEq(spot, spots[k]);
            assertEq(tier, want[k], vm.toString(spots[k]));
            assertEq(status, want[k] == 0 ? 2 : 1);
        }
        // the next night: same counts with spot 13 under 1 % (in reach, got away), the first shot on spot 3: 7 is Epic
        uint32 n = N1104 + 1;
        vm.warp(qc.nightStart(n) + 60);
        uint16[16] memory c = _counts1104v12();
        c[1] += c[13] - 39;
        c[13] = 39;
        uint256 epic = _castOn(7, c);
        uint256 low = _castOn(13, c);
        vm.warp(qc.nightOverAt(n));
        _postF(n, c, TURNS_1104, STEPS_1104_V12, 3);
        (uint8 st,,,,, uint8 t,) = qc.result(epic);
        assertEq(t, 4);
        assertEq(st, 1);
        (st,,,,, t,) = qc.result(low);
        assertEq(t, 0, "39 of 4000 in reach: got away");
        assertEq(st, 2);
        assertEq(qc.reachOf(low), 1);
    }
}
