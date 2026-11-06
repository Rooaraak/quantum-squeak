"""contracts/test/data/reach-vectors.json: which spots a perfect walk can land on (quantum/wheel.py ideal_walk, turned by
the ring turn: turned(ideal_walk(steps), turns % 16), P > 1e-12) for random nights of k = 0..16 steps, so the contract's
reach rule is checked against the walk itself for EVERY spot.  python3 contracts/test/data/make_reach_vectors.py

The contract's rule: in reach iff (spot + turns + steps) is even AND the spot is at most `steps` spots from his start
(spot turns % 16) around the ring.  It knows only turns and steps, not each step's turns.

The one known exception, skipped here and only here: a step AFTER THE FIRST with 700 or more turns.  Its coin flips fully
(wheel.py angle() = pi), which sends the walk straight back over the step before it (that pair of steps moves nowhere),
so the walk can reach fewer spots than the rule says: 100 then 700 turns lands only on his start, not 2 spots away.
"Every step has >= 700 turns" (k >= 2) is part of this case; a first step of 700+ is not (it is checked, kept).
Any other vector where the rule and the walk differ makes this script FAIL: nothing else is skipped.

`known` (checked by test/Reach.t.sol, not skipped silently): worked examples of where the rule says in reach but the walk
can not land, or lands with a chance under the 1e-12 cut (steps close to 700 turns: the coin almost flips)."""
import json, os, random, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, '../../../quantum')); import wheel
N, CUT, FULL = 16, 1e-12, wheel.MAX_TURNS

def ring_distance(a, b):
    d = abs(a - b) % N
    return min(d, N - d)

def rule(spot, turns, k):
    """the contract's reach rule (QuantumCatch._inReach)"""
    return (spot + turns + k) % 2 == 0 and ring_distance(spot, turns % N) <= k

def walk_mask(steps, turns):
    p = wheel.turned(wheel.ideal_walk(steps), turns % N)
    return sum(1 << s for s in range(N) if p[s] > CUT), p

def rule_mask(turns, k):
    return sum(1 << s for s in range(N) if rule(s, turns, k))

def exception(steps):
    """a step after the first with >= 700 turns: the coin flips fully and the walk steps back over the step before"""
    return any(t >= FULL for t in steps[1:])

rng = random.Random(20261105)
chain = json.load(open(os.path.join(here, '../../../data/chain-nights.json')))['nights']
his = sorted(r['turns'] for n in chain.values() for r in n['rounds'] if r['turns'] > 0)   # his real rounds

def one_step(mode):
    if mode == 'his': return rng.choice(his)                       # a real round of his
    if mode == 'any': return rng.randint(1, FULL - 1)              # anything under a full flip
    return rng.randint(FULL, 2 * FULL) if rng.random() < 0.3 else rng.randint(1, FULL - 1)   # 'flips': some 700+

plan = [0] * 12 + [k for k in range(1, 8) for _ in range(70)] + [k for k in range(8, 17) for _ in range(20)]
out = {'source': 'quantum/wheel.py ideal_walk, turned(.., turns % 16), P > 1e-12', 'cut': CUT,
       'k': [], 'turns': [], 'mask': [], 'steps': []}
skipped, modes = 0, {'his': 0, 'any': 0, 'flips': 0}
for k in plan:
    mode = rng.choices(['his', 'any', 'flips'], [50, 35, 15])[0]
    steps = [one_step(mode) for _ in range(k)]
    if exception(steps):
        skipped += 1
        continue
    # total turns: the sum of the steps (up to 10 rounds, steps = rounds), or more (more rounds: steps are group means)
    turns = sum(steps) + (0 if rng.random() < 0.6 else rng.randint(1, 9000)) if k else rng.randint(0, 20000)
    m, p = walk_mask(steps, turns)
    want = rule_mask(turns, k)
    if m != want:
        bad = [s for s in range(N) if (m >> s & 1) != (want >> s & 1)]
        sys.exit(f'FAIL: the rule and the walk differ outside the known exception: steps {steps} turns {turns}: '
                 + ', '.join(f'spot {s} P={p[s]:.3g} rule={rule(s, turns, k)}' for s in bad))
    modes[mode] += 1
    for key, v in (('k', k), ('turns', turns), ('mask', m), ('steps', steps)): out[key].append(v)

known = []
for why, steps, turns in (
        ('a 700+ turn step after the first (the exception): 100 then 700 turns lands only on his start', [100, 700], 800),
        ('every step 700+ (the exception): the walk only swings between his start and its two neighbours', [700, 700, 700], 2100),
        ('7 steps of 667 turns (his fastest real round): the 2 farthest spots have P = 1.3e-14, under the cut', [667] * 7, 4669),
        ('the task example: 1 step lands only on the 2 neighbours of his start', [350], 9)):
    m, p = walk_mask(steps, turns)
    k = len(steps)
    known.append({'why': why, 'steps': steps, 'k': k, 'turns': turns, 'walk': m, 'rule': rule_mask(turns, k),
                  'p': [float(f'{x:.3g}') for x in p]})
    assert m & ~rule_mask(turns, k) == 0, 'the walk never lands outside the rule'
out['known'] = known
out['skipped_exception'] = skipped
json.dump(out, open(os.path.join(here, 'reach-vectors.json'), 'w'), separators=(',', ':'))
ks = out['k']
print(len(ks), 'vectors', {k: ks.count(k) for k in sorted(set(ks))}, 'by mode', modes,
      '| skipped (a 700+ step after the first):', skipped)
