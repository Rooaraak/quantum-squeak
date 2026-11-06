// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {HonestyBase} from "./Honesty.t.sol";
import {T} from "./URI.t.sol";
import {QuantumCatch, IPaintedArt} from "../src/QuantumCatch.sol";

/// the contract's own reach rule, for k = 0 too (a ran night cannot be posted with 0 steps: 0 steps means he slept)
contract ReachProbe is QuantumCatch {
    constructor() QuantumCatch(address(1), IPaintedArt(address(0))) {}

    function inReach(uint256 spot, uint256 turns, uint256 steps) external pure returns (bool) {
        return _inReach(spot, turns, steps);
    }
}

/// the rule itself on every vector, k = 0..16, every spot (the k >= 1 vectors also go through postNight below)
contract ReachRuleTest is Test {
    function test_rule_matches_the_ideal_walk_for_every_k_and_spot() public {
        ReachProbe p = new ReachProbe();
        string memory j = vm.readFile("test/data/reach-vectors.json");
        uint256[] memory k = vm.parseJsonUintArray(j, ".k");
        uint256[] memory turns = vm.parseJsonUintArray(j, ".turns");
        uint256[] memory mask = vm.parseJsonUintArray(j, ".mask");
        uint256 zero;
        for (uint256 i; i < k.length; ++i) {
            if (k[i] == 0) ++zero;
            for (uint256 s; s < 16; ++s) {
                assertEq(
                    p.inReach(s, turns[i], k[i]),
                    (mask[i] >> s) & 1 == 1,
                    string.concat("vector ", vm.toString(i), " spot ", vm.toString(s))
                );
            }
        }
        assertGt(zero, 5, "k = 0: only his start");
    }
}

/// Reach = where a perfect walk can land: after k steps only on spots of the parity of k counted from his start (spot
/// turns % 16) AND at most k spots from it around the ring. Checked against quantum/wheel.py ideal_walk for every spot
/// (test/data/reach-vectors.json, made by test/data/make_reach_vectors.py), through the public calls a holder uses.
contract ReachVectorsTest is HonestyBase {
    string internal constant VECTORS = "test/data/reach-vectors.json";
    uint32 internal constant FIRST = N1104 + 1; // vector i is posted as night FIRST + i

    function _player(uint256 s) internal pure returns (address) {
        return address(uint160(0x5EED0000 + s));
    }

    /// cast one net on each of the 16 spots for night n, post (turns, steps) with 250 landings on every spot
    /// (6.25 %: catchable wherever it is in reach; all equal, so they rank by spot number) and the first shot on spot 0,
    /// and return the nets
    function _night(uint32 n, uint256 turns, uint256 steps) internal returns (uint256[16] memory ids) {
        vm.warp(qc.nightStart(n) + 60);
        for (uint256 s; s < 16; ++s) {
            vm.prank(_player(s));
            ids[s] = qc.castNet(uint8(s));
        }
        vm.warp(qc.nightOverAt(n));
        uint16[16] memory c;
        for (uint256 s; s < 16; ++s) {
            c[s] = 250;
        }
        _postK(n, c, uint32(turns), uint8(steps));
    }

    /// reachOf and result() of every spot against a 16-bit mask (bit s = spot s in reach); every spot in reach is
    /// catchable (250 of 4000), so its tier is its rank by spot number (all landings equal, the lower spot first)
    function _expect(uint256[16] memory ids, uint256 mask, string memory label) internal view {
        uint16[16] memory c;
        for (uint256 s; s < 16; ++s) {
            c[s] = 250;
        }
        uint8[16] memory want = _rankTiers(c, mask, 0);
        for (uint256 s; s < 16; ++s) {
            bool reach = (mask >> s) & 1 == 1;
            string memory at = string.concat(label, " spot ", vm.toString(s));
            assertEq(qc.reachOf(ids[s]), reach ? 1 : 2, at);
            (uint8 status,,, uint16 hits,, uint8 tier,) = qc.result(ids[s]);
            assertEq(hits, 250, at);
            assertEq(tier, want[s], at);
            assertTrue(reach ? tier > 0 : tier == 0, at);
            assertEq(status, reach ? 1 : 2, at);
        }
    }

    function _vectors(uint256 from, uint256 to) internal {
        string memory j = vm.readFile(VECTORS);
        uint256[] memory k = vm.parseJsonUintArray(j, ".k");
        uint256[] memory turns = vm.parseJsonUintArray(j, ".turns");
        uint256[] memory mask = vm.parseJsonUintArray(j, ".mask");
        assertGt(k.length, 500, "vectors");
        if (to > k.length) to = k.length;
        uint256 done;
        for (uint256 i = from; i < to; ++i) {
            if (k[i] == 0) continue; // 0 steps = he slept: no walk to post (ReachRuleTest checks the rule itself)
            uint256[16] memory ids = _night(FIRST + uint32(i), turns[i], k[i]);
            _expect(ids, mask[i], string.concat("vector ", vm.toString(i), " k ", vm.toString(k[i])));
            ++done;
        }
        assertGt(done, 0);
    }

    // four slices, so each test stays far under the per-test gas limit
    function test_reach_matches_the_ideal_walk_vectors_0() public {
        _vectors(0, 160);
    }

    function test_reach_matches_the_ideal_walk_vectors_1() public {
        _vectors(160, 320);
    }

    function test_reach_matches_the_ideal_walk_vectors_2() public {
        _vectors(320, 480);
    }

    function test_reach_matches_the_ideal_walk_vectors_3() public {
        _vectors(480, 1000);
    }

    function test_vectors_cover_every_short_walk() public view {
        uint256[] memory k = vm.parseJsonUintArray(vm.readFile(VECTORS), ".k");
        uint256[17] memory per;
        for (uint256 i; i < k.length; ++i) {
            ++per[k[i]];
        }
        for (uint256 s; s <= 16; ++s) {
            assertGt(per[s], s >= 1 && s <= 7 ? 50 : 10, string.concat("vectors with k = ", vm.toString(s)));
        }
    }

    /// the documented gaps (README): the contract knows only turns and steps, not each step's turns, so it says in
    /// reach where a 700+ turn step after the first sent the walk back (P = 0), or where steps close to 700 turns
    /// leave a chance under 1e-12. The walk never lands outside the rule.
    function test_known_cases_follow_the_rule() public {
        string memory j = vm.readFile(VECTORS);
        for (uint256 i; i < 4; ++i) {
            string memory key = string.concat(".known[", vm.toString(i), "]");
            uint256 k = vm.parseJsonUint(j, string.concat(key, ".k"));
            uint256 turns = vm.parseJsonUint(j, string.concat(key, ".turns"));
            uint256 walk = vm.parseJsonUint(j, string.concat(key, ".walk"));
            uint256 rule = vm.parseJsonUint(j, string.concat(key, ".rule"));
            assertEq(walk & ~rule, 0, "the walk never lands outside the rule");
            uint256[16] memory ids = _night(FIRST + 2000 + uint32(i), turns, k);
            _expect(ids, rule, vm.parseJsonString(j, string.concat(key, ".why")));
            if (i < 3) assertTrue(walk != rule, "a documented gap");
            else assertEq(walk, rule, "the task example: exact");
        }
    }
}

/// The short-night bug: with k < 8 steps the parity rule alone put spots more than k away in reach.
contract ShortNightTest is HonestyBase {
    /// one step from spot 9 (9 turns): only spots 8 and 10 can be landed on; positions 3..13 have P = 0. Both have
    /// 250 landings: spot 8 ranks first (Rare), spot 10 last (Epic; the first shot, on spot 0, is out of reach)
    function test_one_step_reaches_only_the_two_neighbours() public {
        uint256[16] memory ids;
        vm.warp(qc.nightStart(N1104) + 60);
        for (uint256 s; s < 16; ++s) {
            ids[s] = _cast(makeAddr(string.concat("p", vm.toString(s))), uint8(s));
        }
        vm.warp(OVER_1104);
        uint16[16] memory c;
        for (uint256 s; s < 16; ++s) {
            c[s] = 250;
        }
        _postK(N1104, c, 9, 1);
        for (uint256 s; s < 16; ++s) {
            bool reach = s == 8 || s == 10;
            assertEq(qc.reachOf(ids[s]), reach ? 1 : 2, vm.toString(s));
            (uint8 status,,,,, uint8 tier,) = qc.result(ids[s]);
            assertEq(status, reach ? 1 : 2, vm.toString(s));
            assertEq(tier, s == 8 ? 3 : s == 10 ? 4 : 0, vm.toString(s));
        }
    }

    /// 2.5 % chip noise 3 spots from his start after 1 step: the parity rule called it in reach (a Rare catch)
    function test_noise_three_spots_away_after_one_step_never_catches() public {
        uint256 id = _cast(alice, 12);
        vm.warp(OVER_1104);
        _postK(N1104, _one(12, 100, 3900), 9, 1); // 12 + 9 + 1 even, but 3 spots from his start (spot 9)
        assertGe(uint256(100) * 100, 4000, "2.5 %: catchable, were it in reach");
        (uint8 status,,, uint16 hits,, uint8 tier,) = qc.result(id);
        assertEq(status, 2, "got away");
        assertEq(tier, 0);
        assertEq(hits, 100, "the landings stay visible");
        assertEq(qc.reachOf(id), 2);
        string memory j = _json(id);
        assertEq(vm.parseJsonString(j, _trait(j, 12, "Reach")), "Out of reach tonight");
        assertTrue(
            T.contains(
                vm.parseJsonString(j, ".description"),
                "Out of reach tonight: he could not land here; the 100 landings here are the chip's noise."
            )
        );
    }

    /// every short walk, every start, every spot: the contract against the walk's own positions (each step +1 or -1)
    function test_every_short_walk_against_the_positions_it_can_reach() public {
        for (uint256 k = 1; k <= 9; ++k) {
            for (uint256 start; start < 16; start += 5) {
                uint32 n = N1104 + uint32(k * 16 + start);
                uint256 turns = 16 * k + start; // ring turn = start, turns >= steps
                vm.warp(qc.nightStart(n) + 60);
                uint256[16] memory ids;
                for (uint256 s; s < 16; ++s) {
                    ids[s] = _cast(address(uint160(0xBEEF00 + s)), uint8(s));
                }
                vm.warp(qc.nightOverAt(n));
                _postK(n, _one(0, 1, 1), uint32(turns), uint8(k));
                for (uint256 s; s < 16; ++s) {
                    assertEq(qc.reachOf(ids[s]), _lands(s, start, k) ? 1 : 2);
                }
            }
        }
    }

    /// a walk of k steps of +1 / -1 from `start` ends on start + x, x in {-k, -k + 2, ..., k}, around the ring of 16
    function _lands(uint256 spot, uint256 start, uint256 k) internal pure returns (bool) {
        for (int256 x = -int256(k); x <= int256(k); x += 2) {
            if (uint256((int256(start) + x) % 16 + 16) % 16 == spot) return true;
        }
        return false;
    }
}

/// The description says exactly where a perfect walk can land, and the image stays readable.
contract ReachWordsTest is HonestyBase {
    string internal constant RULE = "a perfect walk can only land on spots of the right parity within ";

    function test_description_before_the_post_has_no_number() public {
        string memory d = vm.parseJsonString(_json(_cast(alice, 3)), ".description");
        assertTrue(
            T.contains(
                d,
                "After k steps a perfect walk can only land on spots of the right parity within k spots of his start (his total turns mod 16): those are the spots in reach."
            ),
            d
        );
        assertFalse(T.contains(d, "every other spot"), "no overstatement for short walks");
    }

    function test_description_names_the_steps_and_the_start() public {
        uint256 a = _cast(alice, 1);
        vm.warp(OVER_1104);
        _postK(N1104, _counts1104v12(), TURNS_1104, STEPS_1104_V12); // 10 steps, start 3817 % 16 = 9
        string memory d = vm.parseJsonString(_json(a), ".description");
        assertTrue(
            T.contains(
                d,
                "After its 10 steps a perfect walk can only land on spots of the right parity within 10 spots of his start (spot 9): those are the spots in reach tonight."
            ),
            d
        );
        assertFalse(T.contains(d, "every other spot"));

        vm.warp(qc.nightStart(N1104 + 1) + 60);
        uint256 b = _cast(alice, 4);
        vm.warp(qc.nightOverAt(N1104 + 1));
        _postK(N1104 + 1, _one(4, 1, 1), 3, 1);
        d = vm.parseJsonString(_json(b), ".description");
        assertTrue(
            T.contains(
                d,
                "After its 1 step a perfect walk can only land on spots of the right parity within 1 spot of his start (spot 3): those are the spots in reach tonight."
            ),
            d
        );
    }

    function test_description_of_a_slept_night_has_no_number() public {
        uint256 id = _cast(alice, 2);
        vm.warp(OVER_1104);
        uint16[16] memory zero;
        _postK(N1104, zero, 0, 0);
        string memory d = vm.parseJsonString(_json(id), ".description");
        assertTrue(T.contains(d, string.concat("After k steps ", RULE, "k spots of his start")), d);
    }

    /// spots 7 and 9 sit at the bottom of the ring: their dashed net circle (r 15 around y 289.3, so its top edge with
    /// the stroke is at y 273.1) must stay clear of the caption. Out of reach the caption is two lines at y 252 and
    /// 252 + 12 = 264 (no descenders on the second line): 9 px clear.
    function test_out_of_reach_caption_clears_the_net_on_spots_7_and_9() public {
        uint256 seven = _cast(alice, 7);
        uint256 nine = _cast(bob, 9);
        vm.warp(OVER_1104);
        uint16[16] memory c;
        c[9] = 46;
        c[0] = 3954;
        _postK(N1104, c, 16, 1); // start 0, 1 step: only spots 1 and 15 in reach
        string memory s7 = _svg(_json(seven));
        string memory s9 = _svg(_json(nine));
        string memory lines =
            '<text x="160" y="236" text-anchor="middle" font-size="13" font-weight="bold" fill="#4a5562">GOT AWAY</text><text x="160" y="252" text-anchor="middle" font-size="9" fill="#4a5562">';
        assertTrue(T.contains(s9, string.concat(lines, '46 of 4000 shots: chip noise<tspan x="160" dy="12">he could not land here</tspan></text>')), s9);
        assertTrue(T.contains(s7, string.concat(lines, 'no landings<tspan x="160" dy="12">he could not land here</tspan></text>')), s7);
        assertFalse(T.contains(s7, "0 of 4000"), "no landings, not 0 of 4000 shots: chip noise");
        assertFalse(T.contains(s7, "chip noise"));
        assertTrue(T.contains(s7, "id=\"outofreach\""));
    }

    /// in reach, a got-away net keeps the one-line caption at the usual height
    function test_in_reach_caption_unchanged() public {
        uint256 id = _cast(alice, 1);
        vm.warp(OVER_1104);
        _postK(N1104, _one(1, 0, 4000), 16, 1); // spot 1 in reach, no landings
        string memory s = _svg(_json(id));
        assertTrue(
            T.contains(s, '<text x="160" y="262" text-anchor="middle" font-size="9" fill="#4a5562">0 of 4000 shots on spot 1</text>'),
            s
        );
    }

    /// a caught hamster with neckwear (spot bit 2): the scarf's tail ends at y 228, above the CAUGHT label (cap top
    /// about y 236.5 for 13 px bold at y 246)
    function test_scarf_tail_clears_the_caught_label() public {
        uint256 id = _cast(alice, 15); // hat, glasses, scarf, grin
        _post1104(); // 808 / 4000: Common
        string memory s = _svg(_json(id));
        assertTrue(T.contains(s, "CAUGHT &#183; COMMON"));
        assertTrue(T.contains(s, '<path d="M186 206l7 22 14-4-6-20z" fill="#c2403e"/>'), s);
        assertFalse(T.contains(s, "M186 206l9 32"), "the old tail reached y 238");
    }
}
