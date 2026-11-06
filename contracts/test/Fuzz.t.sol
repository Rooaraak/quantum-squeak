// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {CatchBase} from "./Base.t.sol";
import {QuantumCatch} from "../src/QuantumCatch.sol";

contract CatchFuzzTest is CatchBase {
    uint256 internal constant MAX_T = 1 << 40; // ~ year 36,800

    function _refNight(uint256 t) internal pure returns (uint256) {
        return (t - 43200) / 86400;
    }

    function _refOpen(uint256 t) internal pure returns (uint256) {
        uint256 n = _refNight(t);
        return t < n * 86400 + 43200 + 32400 ? n : n + 1;
    }

    function testFuzz_night_and_openNight_match_the_formula(uint256 t) public view {
        t = bound(t, 43200, MAX_T);
        assertEq(qc.nightOf(t), _refNight(t));
        assertEq(qc.openNightAt(t), _refOpen(t));
        uint32 n = qc.nightOf(t);
        assertLe(qc.nightStart(n), t);
        assertGt(qc.nightStart(n) + 86400, t);
    }

    function testFuzz_lock_window(uint32 n, uint256 offset) public view {
        n = uint32(bound(n, 0, 4_000_000));
        offset = bound(offset, 0, 86399);
        uint256 t = qc.nightStart(n) + offset;
        assertEq(qc.openNightAt(t), offset < 32400 ? n : n + 1);
    }

    function testFuzz_castNet_lands_in_the_open_night(uint256 t, address who, uint8 spot) public {
        t = bound(t, 43200, MAX_T);
        spot = uint8(bound(spot, 0, 15));
        vm.assume(who != address(0) && who != hatcher);
        assumeNotForgeAddress(who);
        vm.warp(t);
        vm.prank(who);
        uint256 id = qc.castNet(spot);
        assertEq(id >> 160, _refOpen(t));
        assertEq(address(uint160(id)), who);
        assertEq(qc.ownerOf(id), who);
        (, uint32 night, uint8 s,,,, uint8 looks) = qc.result(id);
        assertEq(night, _refOpen(t));
        assertEq(s, spot);
        assertEq(looks, spot);
        vm.prank(who);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.AlreadyCast.selector, uint32(_refOpen(t)), who));
        qc.castNet(spot);
    }

    function testFuzz_spot_range(uint8 spot) public {
        vm.prank(alice);
        if (spot >= 16) {
            vm.expectRevert(abi.encodeWithSelector(QuantumCatch.SpotOutOfRange.selector, spot));
            qc.castNet(spot);
        } else {
            qc.castNet(spot);
            (,, uint8 s,,,,) = qc.result(qc.netId(N1104, alice));
            assertEq(s, spot);
        }
    }

    function testFuzz_ids_are_unique(uint32 n1, address a1, uint32 n2, address a2) public view {
        uint256 i1 = qc.netId(n1, a1);
        uint256 i2 = qc.netId(n2, a2);
        assertEq(i1 == i2, n1 == n2 && a1 == a2);
        assertEq(i1 >> 160, n1);
        assertEq(address(uint160(i1)), a1);
    }

    function testFuzz_missing_ids_revert(uint256 id) public {
        uint256 mine = _cast(alice, 3);
        vm.assume(id != mine);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.ownerOf(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.result(id);
        vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NonexistentToken.selector, id));
        qc.tokenURI(id);
    }

    function testFuzz_postNight_time_gate(uint32 n, uint256 t) public {
        n = uint32(bound(n, 10, 4_000_000));
        uint256 over = uint256(n) * 86400 + 43200 + 86400;
        uint256 closed = over + 14 days;
        t = bound(t, over - 3 days, closed + 3 days);
        vm.warp(t);
        uint16[16] memory c = _counts1104();
        vm.prank(hatcher);
        if (t < over) {
            vm.expectRevert(abi.encodeWithSelector(QuantumCatch.NightNotOver.selector, n, over));
        } else if (t >= closed) {
            vm.expectRevert(abi.encodeWithSelector(QuantumCatch.PostWindowClosed.selector, n, closed));
        }
        qc.postNight(n, c, 1, 1, JOB_1104, SHA_1104, 15);
        (bool posted,,,,,,,,) = qc.nightRecord(n);
        assertEq(posted, t >= over && t < closed);
    }

    function testFuzz_postNight_consistency(uint16[16] memory c, uint32 turns, uint8 steps, uint8 first) public {
        steps = uint8(bound(steps, 0, 20));
        first = uint8(bound(first, 0, 20));
        vm.warp(OVER_1104);
        uint256 sum;
        for (uint256 i; i < 16; ++i) {
            sum += c[i];
        }
        bool ok = _expectPostOutcome(c, sum, turns, steps, first);
        vm.prank(hatcher);
        qc.postNight(N1104, c, turns, steps, JOB_1104, SHA_1104, first);
        _checkRecord(ok, c, sum, turns, steps, first);
    }

    /// arms the revert postNight must give (in the contract's order of checks); true when it must succeed
    function _expectPostOutcome(uint16[16] memory c, uint256 sum, uint32 turns, uint8 steps, uint8 first)
        internal
        returns (bool)
    {
        bool stepsOk = turns == 0 ? steps == 0 : (steps >= 1 && steps <= 16 && steps <= turns);
        bool firstOk = turns == 0 ? first == 0 : (first < 16 && c[first] > 0);
        if (turns == 0 && sum > 0) vm.expectRevert(QuantumCatch.SleptButLandings.selector);
        else if (turns > 0 && sum == 0) vm.expectRevert(QuantumCatch.NoLandings.selector);
        else if (!stepsOk) vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadSteps.selector, turns, steps));
        else if (!firstOk) vm.expectRevert(abi.encodeWithSelector(QuantumCatch.BadFirstShot.selector, first));
        return (turns == 0) == (sum == 0) && stepsOk && firstOk;
    }

    function _checkRecord(bool ok, uint16[16] memory c, uint256 sum, uint32 turns, uint8 steps, uint8 first)
        internal
        view
    {
        (bool posted, uint16[16] memory got, uint32 shots, uint32 tt, uint8 ring, uint8 k,,, uint8 f) =
            qc.nightRecord(N1104);
        assertEq(posted, ok);
        if (!ok) return;
        assertEq(shots, sum);
        assertEq(tt, turns);
        assertEq(ring, turns % 16);
        assertEq(k, steps);
        assertEq(f, first);
        for (uint256 i; i < 16; ++i) {
            assertEq(got[i], c[i]);
        }
    }

    function testFuzz_reach_is_where_the_walk_can_land(uint8 spot, uint16 hits, uint32 turns, uint8 steps) public {
        spot = uint8(bound(spot, 0, 15));
        turns = uint32(bound(turns, 1, type(uint32).max));
        steps = uint8(bound(steps, 1, 16));
        if (steps > turns) steps = uint8(turns);
        uint256 id = _cast(alice, spot);
        uint16[16] memory c;
        c[spot] = uint16(bound(hits, 0, 4000));
        c[(spot + 1) % 16] = 4000 - c[spot];
        vm.warp(OVER_1104);
        _postK(N1104, c, turns, steps);
        bool reach = _walkReach(spot, turns, steps);
        assertEq(qc.reachOf(id), reach ? 1 : 2);
        (uint8 status,,, uint16 got,, uint8 tier,) = qc.result(id);
        assertEq(got, c[spot], "the landings stay visible");
        assertEq(tier, _refTiers(c, turns, steps, _firstOf(c))[spot], "the rank rule");
        if (!reach) assertEq(tier, 0, "out of reach never catches");
        assertEq(status, tier > 0 ? 1 : 2);
    }

    /// tiersOf = the test's own sort-based rule, for any numbers; and every night has one Epic or Legendary, one
    /// Rare, two Uncommon and the rest Common (fewer when there are few catchable spots)
    function testFuzz_tiersOf_matches_the_reference(uint16[16] memory c, uint32 turns, uint8 steps, uint8 first)
        public
        view
    {
        steps = uint8(bound(steps, 1, 16));
        first = uint8(bound(first, 0, 15));
        for (uint256 s; s < 16; ++s) {
            if (uint256(c[s]) % 3 == 0) c[s] = uint16(uint256(c[s]) % 64); // ties and small counts, often
        }
        uint8[16] memory t = qc.tiersOf(c, turns, steps, first);
        uint8[16] memory r = _refTiers(c, turns, steps, first);
        uint256 n;
        uint256[6] memory per;
        for (uint256 s; s < 16; ++s) {
            assertEq(t[s], r[s], vm.toString(s));
            if (!_walkReach(s, turns, steps)) assertEq(t[s], 0, "out of reach never catches");
            if (t[s] > 0) ++n;
            ++per[t[s]];
        }
        assertEq(per[4] + per[5], n > 0 ? 1 : 0);
        assertEq(per[5], n > 0 && t[first] == 5 ? 1 : 0);
        assertEq(per[3], n >= 2 ? 1 : 0);
        assertEq(per[2], n >= 4 ? 2 : n == 3 ? 1 : 0);
        assertEq(per[1], n > 4 ? n - 4 : 0);
    }

    function testFuzz_result_state(uint8 spot, uint16[16] memory c, uint32 turns) public {
        spot = uint8(bound(spot, 0, 15));
        uint256 sum;
        for (uint256 i; i < 16; ++i) {
            sum += c[i];
        }
        if (turns == 0) c = [uint16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        else if (sum == 0) c[spot] = 1;
        sum = 0;
        for (uint256 i; i < 16; ++i) {
            sum += c[i];
        }
        uint256 id = _cast(alice, spot);
        vm.warp(OVER_1104);
        _post(N1104, c, turns);
        (uint8 status,,, uint16 hits, uint32 shots, uint8 tier,) = qc.result(id);
        if (turns == 0) {
            assertEq(status, 3);
            assertEq(tier, 0);
            assertEq(shots, 0);
            assertEq(qc.reachOf(id), 0);
        } else {
            bool reach = _walkReach(spot, turns, _stepsFor(turns));
            assertEq(hits, c[spot]);
            assertEq(shots, sum);
            assertEq(qc.reachOf(id), reach ? 1 : 2);
            assertEq(tier, _refTiers(c, turns, _stepsFor(turns), _firstOf(c))[spot]);
            if (!reach) assertEq(tier, 0);
            assertEq(status, tier > 0 ? 1 : 2);
        }
    }
}
