"""contracts/test/data/tier-vectors.json: the owner's rarity rule (5 Nov), computed here in plain Python, on the 9 real
chip result files in quantum/ (wheel-2026-*-ibm_marrakesh-*.json) and on random synthetic nights, so the contract's tier
for EVERY spot is checked against this reference.  python3 contracts/test/data/make_tier_vectors.py

The rule (QuantumCatch.tiersOf):
  - catchable tonight = a spot IN REACH (the contract's rule: (spot + turns + steps) even AND ring distance from his
    start, spot turns % 16, at most steps) whose landings are at least 1 % of the night's shots (hits * 100 >= shots);
  - rank the catchable spots by landings, most first; equal landings: the lower spot number first. n = how many, r = 1..n;
  - Epic r = n, Rare r = n - 1, Uncommon r = n - 3 or n - 2, Common r <= n - 4;
  - Legendary = the Epic spot when the chip's very first shot of the night landed on it (first shot = the file's
    shots_in_order[0], a POSITION, turned onto the ring: spot = (position + total turns) % 16);
  - every other spot: tier 0 (got away; out of reach always).
Tier codes: 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary.

Per vector (flat arrays, 16 entries per vector for counts and tier): counts per SPOT, turns, steps, first (spot), tier.
`real` marks the vectors taken from a real file (first = the file's own first shot, or every other spot that has a
landing: the counts and reach are real, only the first shot is varied)."""
import json, os, random, sys
from fractions import Fraction

here = os.path.dirname(os.path.abspath(__file__))
QDIR = os.path.join(here, '../../../quantum')
N = 16
COMMON, UNCOMMON, RARE, EPIC, LEGENDARY = 1, 2, 3, 4, 5


def ring_distance(a, b):
    d = abs(a - b) % N
    return min(d, N - d)


def in_reach(spot, turns, steps):
    """the contract's reach rule (QuantumCatch._inReach, cf509b4)"""
    return (spot + turns + steps) % 2 == 0 and ring_distance(spot, turns % N) <= steps


def catchable(counts, turns, steps):
    shots = sum(counts)
    return [s for s in range(N) if in_reach(s, turns, steps) and shots and Fraction(counts[s], shots) >= Fraction(1, 100)]


def night_tiers(counts, turns, steps, first):
    """the owner's rule: tier per spot, 0 = got away"""
    order = sorted(catchable(counts, turns, steps), key=lambda s: (-counts[s], s))   # most landings first, ties: lower spot
    n, tiers = len(order), [0] * N
    for r, s in enumerate(order, 1):
        if r == n: tiers[s] = LEGENDARY if s == first else EPIC
        elif r == n - 1: tiers[s] = RARE
        elif r >= n - 3: tiers[s] = UNCOMMON
        else: tiers[s] = COMMON
    return tiers


def turned(pos_counts, turns):
    out = [0] * N
    for p, c in enumerate(pos_counts): out[(p + turns) % N] = c
    return out


out = {'source': 'contracts/test/data/make_tier_vectors.py night_tiers (the owner rarity rule, 5 Nov)',
       'counts': [], 'turns': [], 'steps': [], 'first': [], 'tier': [], 'real': [], 'files': []}


def add(counts, turns, steps, first, real=0):
    assert len(counts) == N and all(0 <= c <= 65535 for c in counts) and sum(counts) > 0
    assert 1 <= steps <= 16 and steps <= turns < 2 ** 32 and counts[first] > 0, (counts, turns, steps, first)
    out['counts'] += counts; out['turns'].append(turns); out['steps'].append(steps); out['first'].append(first)
    out['tier'] += night_tiers(counts, turns, steps, first); out['real'].append(real)


# ---- the 9 real chip nights: their own first shot, then every other spot with a landing as the first shot
files = sorted(f for f in os.listdir(QDIR) if f.startswith('wheel-2026-') and '-ibm_marrakesh-' in f and f.endswith('.json'))
assert len(files) == 9, files
for f in files:
    d = json.load(open(os.path.join(QDIR, f)))
    turns = sum(r[1] for r in d['rounds'])
    steps = len(d['steps'])
    counts = turned(d['counts'], turns)
    first = (d['shots_in_order'][0] + turns) % N
    assert sum(d['counts']) == len(d['shots_in_order']) == d['wheel_shots']
    out['files'].append({'file': f, 'turns': turns, 'steps': steps, 'first': first, 'index': len(out['turns'])})
    add(counts, turns, steps, first, 1)
    for alt in range(N):
        if alt != first and counts[alt] > 0: add(counts, turns, steps, alt, 2)

# ---- synthetic nights
rng = random.Random(20261105)


def pick_first(counts, tiers_hint):
    """the first shot: often on tonight's Epic spot (to make Legendaries), else any spot with a landing"""
    landed = [s for s in range(N) if counts[s] > 0]
    order = sorted(catchable(*tiers_hint), key=lambda s: (-counts[s], s))
    if order and rng.random() < 0.4: return order[-1]
    if order and rng.random() < 0.3: return rng.choice(order)
    return rng.choice(landed)


def synth(mode):
    steps = rng.choice([1, 2, 3, 4, 5, 6, 7]) if rng.random() < 0.5 else rng.randint(1, 16)
    turns = rng.randint(steps, 30000) if rng.random() < 0.9 else rng.randint(steps, 2 ** 32 - 1)
    reach = [s for s in range(N) if in_reach(s, turns, steps)]
    out_r = [s for s in range(N) if s not in reach]
    counts = [0] * N
    if mode == 'chip':          # like the chip: most shots in reach, a little noise everywhere
        shots = rng.choice([4000, 4000, 4000, 1000, 2500, 8000, 333])
        w = [rng.random() ** 2 for _ in reach]
        tot = sum(w) or 1
        noise = rng.randint(0, shots // 5)
        for s, x in zip(reach, w): counts[s] = int((shots - noise) * x / tot)
        for _ in range(noise): counts[rng.choice(range(N))] += 1
    elif mode == 'ties':        # many equal landings: the lower spot ranks first
        v = rng.choice([[40, 40, 40], [100, 100, 7], [250, 250, 250, 39], [1, 1, 0], [500, 500, 40, 40]])
        for s in range(N): counts[s] = rng.choice(v)
    elif mode == 'edge':        # exactly 1 % and just under, with shots not always 4000
        shots = rng.choice([4000, 1000, 100, 3999, 4001, 12345])
        edge = -(-shots // 100)              # the smallest count with count * 100 >= shots
        for s in reach: counts[s] = rng.choice([edge, edge - 1, edge + 1, edge * 3, 0])
        rest = shots - sum(counts)
        for _ in range(max(rest, 0)): counts[rng.choice(out_r or reach)] += 1
    elif mode == 'loud_out':    # an out-of-reach spot with most of the landings: never in the ranking
        for s in reach: counts[s] = rng.randint(0, 400)
        if out_r: counts[rng.choice(out_r)] = rng.randint(2000, 60000)
    elif mode == 'few':         # n = 0 .. 5 catchable spots
        want = rng.randint(0, min(5, len(reach)))
        for s in rng.sample(reach, want): counts[s] = rng.randint(50, 900)
        for s in range(N):
            if counts[s] == 0: counts[s] = rng.randint(0, 3)
    else:                       # 'wild': anything up to the uint16 limit
        for s in range(N): counts[s] = rng.choice([0, rng.randint(0, 65535), rng.randint(0, 100)])
    counts = [min(c, 65535) for c in counts]
    if sum(counts) == 0: counts[rng.randrange(N)] = 1
    first = pick_first(counts, (counts, turns, steps))
    return counts, turns, steps, first


modes = ['chip'] * 6 + ['ties'] * 2 + ['edge'] * 2 + ['loud_out', 'few', 'few', 'wild']
for i in range(560):
    add(*synth(modes[i % len(modes)]))

# fixed cases: one per n (0 .. 8), a full tie, the smallest night
fixed = [
    ([4000] + [0] * 15, 16, 2, 0),                                     # start 0, 2 steps: spots 14, 0, 2; only 0 lands: n = 1, Epic
    ([3000, 0, 1000] + [0] * 13, 16, 2, 2),                            # n = 2: 0 Rare, 2 Epic -> first shot there: Legendary
    ([39, 0, 39] + [0] * 11 + [3922, 0], 16, 2, 14),                   # 39 of 4000 under 1 %: n = 1 (spot 14, the first shot: Legendary)
    ([250] * 16, 3817, 10, 7),                                         # 8 in reach, all equal: rank by spot number
    ([1] + [0] * 15, 16, 2, 0),                                        # one shot in all: Legendary (n = 1, first shot)
    ([0, 0, 0, 0, 0, 0, 0, 0, 900, 0, 1000, 0, 0, 0, 0, 0], 9, 1, 8),  # 1 step from spot 9: 8 and 10 only
]
for c, t, k, f in fixed: add(c, t, k, f)

V = len(out['turns'])
tiers = [out['tier'][16 * i:16 * i + 16] for i in range(V)]
per_n = {}
for i in range(V):
    n = sum(1 for x in tiers[i] if x)
    per_n[n] = per_n.get(n, 0) + 1
    # every night: one Epic-or-Legendary, one Rare, two Uncommon, the rest Common (fewer when n is small)
    cnt = [tiers[i].count(t) for t in range(6)]
    assert cnt[4] + cnt[5] == (1 if n else 0) and cnt[3] == (1 if n >= 2 else 0) and cnt[2] == max(0, min(2, n - 2)) \
        and cnt[1] == max(0, n - 4), (i, tiers[i])
legend = sum(1 for i in range(V) if 5 in tiers[i])
assert all(per_n.get(n, 0) >= 5 for n in range(0, 9)), per_n
assert legend >= 50, legend
json.dump(out, open(os.path.join(here, 'tier-vectors.json'), 'w'), separators=(',', ':'))
print(V, 'nights (', sum(1 for r in out['real'] if r), 'from the 9 real files ) | nights per n:', dict(sorted(per_n.items())),
      '| with a Legendary:', legend)
