import json, math, os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import numpy as np
import wheel

NIGHT_1104 = [250, 471, 500, 178, 452, 136, 485, 48, 308, 316, 338, 150, 179]   # chain, new core rounds 195-210

class Steps(unittest.TestCase):
    def test_active_rounds_only_in_order(self):
        self.assertEqual(wheel.steps_from_w([0, 5, 0, 7, 0]), [5, 7])
    def test_more_than_16_are_grouped_evenly(self):
        s = wheel.steps_from_w(list(range(1, 21)), cap=16)  # v1.1: 20 active rounds -> 16 groups: 4 pairs then 12 singles
        self.assertEqual(len(s), 16)
        self.assertEqual(s[:5], [2, 4, 6, 8, 9])            # mean(1,2)=1.5->2, (3,4)->3.5->4, ... then 9
    def test_angle_scale(self):
        self.assertAlmostEqual(wheel.angle(0), 0)
        self.assertAlmostEqual(wheel.angle(350), math.pi / 2)
        self.assertAlmostEqual(wheel.angle(900), math.pi)

class Walks(unittest.TestCase):
    def test_probabilities_sum_to_one(self):
        for f in (wheel.ideal_walk, wheel.normal_walk):
            p = f(NIGHT_1104)
            self.assertEqual(len(p), 16); self.assertAlmostEqual(sum(p), 1.0, places=9)
    def test_quantum_differs_from_normal(self):
        self.assertGreater(sum(abs(a - b) for a, b in zip(wheel.ideal_walk(NIGHT_1104), wheel.normal_walk(NIGHT_1104))), 0.2)
    def test_coasting_hamster_moves_ballistically(self):
        # zero-turn rounds leave the coin alone: from coin (|0>+i|1>)/sqrt2 he splits into two copies, 3 steps each way
        p = wheel.ideal_walk([1e-9, 1e-9, 1e-9])
        self.assertAlmostEqual(p[3], 0.5, places=6); self.assertAlmostEqual(p[13], 0.5, places=6)
    def test_circuit_equals_position_walk(self):
        from qiskit.quantum_info import Statevector
        for night in (NIGHT_1104, [700, 0.0001, 350, 120, 640], [350] * 16):
            qc = wheel.build_circuit(night, measure=False)
            sv = Statevector.from_instruction(qc).probabilities_dict()
            pos = [0.0] * 16
            for bits, pr in sv.items():
                pos[int(bits[:-1], 2)] += pr                     # qiskit bit string: q4 q3 q2 q1 | q0 (coin last)
            for a, b in zip(pos, wheel.ideal_walk(night)):
                self.assertAlmostEqual(a, b, places=9)

VECTORS = os.path.join(os.path.dirname(__file__), '..', '..', 'contracts', 'test', 'data', 'tier-vectors.json')

class Hatch(unittest.TestCase):
    def test_share_tiers_are_gone(self):
        # the owner's rank rule (5 Nov) replaced the share tiers (>= 10 % Common ... 1-1.5 % Legendary)
        self.assertFalse(hasattr(wheel, 'TIERS')); self.assertFalse(hasattr(wheel, 'rarity'))
    def test_reach_parity_and_ring_distance(self):
        # his start = spot turns % 16; after k steps: right parity AND at most k spots from the start around the ring
        self.assertEqual([s for s in range(16) if wheel.in_reach(s, 3, 1)], [2, 4])
        self.assertEqual([s for s in range(16) if wheel.in_reach(s, 16, 2)], [0, 2, 14])
        self.assertEqual([s for s in range(16) if wheel.in_reach(s, 3817, 10)], [s for s in range(16) if (s + 3817 + 10) % 2 == 0])
        self.assertEqual(wheel.ring_distance(1, 15), 2); self.assertEqual(wheel.ring_distance(0, 8), 8)
    def test_rank_rule_examples(self):
        # 8 catchable spots: 4 Common, 2 Uncommon, 1 Rare, 1 Epic; the first shot on the Epic spot makes it Legendary
        counts = [0] * 16
        for s, c in zip(range(0, 16, 2), [800, 700, 600, 500, 400, 300, 200, 100]): counts[s] = c
        counts[1] = 900                                               # out of reach (odd spot): never catches
        turns, steps = 16 * 40, 8                                     # start 0, every even spot in reach
        self.assertEqual(wheel.tiers_of(counts, turns, steps, 0), [1, 0, 1, 0, 1, 0, 1, 0, 2, 0, 2, 0, 3, 0, 4, 0])
        self.assertEqual(wheel.tiers_of(counts, turns, steps, 14)[14], 5)
        counts[14] = 39                                               # under 1 % of 4,439 shots: got away; 12 is Epic now
        self.assertEqual(wheel.tiers_of(counts, turns, steps, 14)[12:], [4, 0, 0, 0])
        tie = [0] * 16; tie[0] = tie[2] = 50                          # equal landings: the lower spot ranks first
        self.assertEqual(wheel.tiers_of(tie, 0 + 16, 2, 2)[:3], [3, 0, 5])
        self.assertEqual(wheel.tiers_of([0] * 16, 0, 0, 0), [0] * 16)   # he slept
    def test_rank_rule_matches_the_contract_vectors(self):
        # contracts/test/data/tier-vectors.json: the contract's tiersOf is checked against the same file (the 9 real
        # chip nights with every landed spot as the first shot, synthetic nights n = 0..8, Legendary cases)
        V = json.load(open(VECTORS))
        n, legendary = len(V['turns']), 0
        self.assertGreater(n, 500)
        for i in range(n):
            counts = V['counts'][16 * i:16 * i + 16]
            got = wheel.tiers_of(counts, V['turns'][i], V['steps'][i], V['first'][i])
            self.assertEqual(got, V['tier'][16 * i:16 * i + 16], f'vector {i}')
            legendary += 5 in got
        self.assertGreater(legendary, 100)
    def test_spot_bits_pick_the_hamster(self):
        self.assertEqual(wheel.looks(0b1011), {'hat': 1, 'glasses': 1, 'neckwear': 0, 'face': 1})

class Health(unittest.TestCase):
    def test_twin_score_and_gate(self):
        good = [{'shots': 250, 'wins': 213}] * 4                     # 85.2 %
        bad = [{'shots': 250, 'wins': 44}] * 4                       # 17.6 %: the 5 Nov 15:41 UTC chip fault
        self.assertAlmostEqual(wheel.twin_score(good), 0.852)
        self.assertTrue(wheel.chip_healthy(good)); self.assertFalse(wheel.chip_healthy(bad))
        self.assertFalse(wheel.chip_healthy([{'shots': 250, 'wins': 197}] * 4))   # 78.8 % < 79 % gate

class Turn(unittest.TestCase):
    def test_ring_is_turned_by_his_total_turns(self):
        self.assertEqual(wheel.ring_turn([6, 250, 471, 500, 178, 452, 136, 485, 48, 308, 316, 338, 150, 179]), 3817 % 16)
        self.assertEqual(wheel.spot_of(15, 3), 2)                    # position 15 on a ring turned by 3 -> spot 2
    def test_turned_shares_are_a_rotation(self):
        p = wheel.ideal_walk([300, 120, 650]); t = 5
        q = wheel.turned(p, t)
        for pos in range(16): self.assertAlmostEqual(q[wheel.spot_of(pos, t)], p[pos])

class RecipeV12(unittest.TestCase):
    def test_cap_is_10_and_old_nights_keep_16(self):
        a = list(range(1, 15))                                         # 14 active rounds
        self.assertEqual(len(wheel.steps_from_w(a)), 10)               # v1.2: at most 10 steps
        self.assertEqual(len(wheel.steps_from_w(a, cap=16)), 14)       # v1.1 archive nights were built with 16
        self.assertEqual(wheel.RECIPE, 'v1.2')

if __name__ == '__main__':
    unittest.main()
