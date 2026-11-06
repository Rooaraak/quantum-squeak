"""The page's Python reference for reach and rarity (the owner's rules, 5 Nov), in plain Python. wheel/engine.js and
wheel/catch.js are checked against it on every spot of every real chip run in quantum/ and on synthetic nights.
  python3 wheel/test/tier_ref.py            -> JSON on stdout (the tests run it)

Reach (contracts cf509b4): the walk starts on his start, spot turns % 16, and each step moves it one spot, so a spot is in
reach that night iff (spot + turns + steps) is even AND its ring distance from his start is at most steps.
Rarity: catchable = in reach AND landings * 100 >= shots (at least 1 %). Rank the catchable spots by landings, most
first; equal landings: the lower spot number first. n = how many, r = 1..n: Epic r = n, Rare r = n - 1, Uncommon
r = n - 3 or n - 2, Common r <= n - 4. Legendary = the Epic spot when the chip's very first shot of the night landed
on it (first shot = the result file's shots_in_order[0], a POSITION, turned onto the ring by quantum/wheel.py spot_of).
Every other spot: got away. Tier codes as the contract: 0 none, 1 Common, 2 Uncommon, 3 Rare, 4 Epic, 5 Legendary."""
import glob, importlib.util, json, os, random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location('qwheel', os.path.join(ROOT, 'quantum', 'wheel.py'))
wheel = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(wheel)   # ring_turn, turned, spot_of, ideal_walk
N = 16


def ring_distance(a, b):
    d = abs(a - b) % N
    return min(d, N - d)


def in_reach(spot, turns, steps):
    return (spot + turns + steps) % 2 == 0 and ring_distance(spot, turns % N) <= steps


def tiers(counts, turns, steps, first):
    shots = sum(counts)
    catchable = [s for s in range(N) if shots and in_reach(s, turns, steps) and counts[s] * 100 >= shots]
    order = sorted(catchable, key=lambda s: (-counts[s], s))          # most landings first; ties: the lower spot first
    n, out = len(order), [0] * N
    for r, s in enumerate(order, 1):
        out[s] = (5 if s == first else 4) if r == n else 3 if r == n - 1 else 2 if r >= n - 3 else 1
    return out


def night(counts, turns, steps, first, **extra):
    return {**extra, 'counts': counts, 'turns': turns, 'steps': steps, 'ringTurn': turns % N, 'first': first,
            'shots': sum(counts), 'reach': [in_reach(s, turns, steps) for s in range(N)], 'tiers': tiers(counts, turns, steps, first)}


# ---- every real chip run in quantum/ (the 7 archive nights and the 2 v1.2 re-runs)
real = []
for f in sorted(glob.glob(os.path.join(ROOT, 'quantum', 'wheel-2026-*-ibm_marrakesh-*.json'))):
    R = json.load(open(f))
    w = [t for _, t in R['rounds']]
    T, turns = wheel.ring_turn(w), sum(w)
    counts = [int(x) for x in wheel.turned(R['counts'], T)]          # per SPOT (the v1.1 ring turn)
    first = wheel.spot_of(R['shots_in_order'][0], T)
    perfect = wheel.turned(wheel.ideal_walk(R['steps']), T)
    real.append(night(counts, turns, len(R['steps']), first, file=os.path.basename(f), night=R['night'], job_id=R['job_id'],
                      recipe=R['recipe'], perfectReach=[p > 1e-12 for p in perfect]))

# ---- synthetic nights: Legendary, every n from 0 to 8, ties at the bottom, the 1 % line with shots other than 4,000,
# short nights (1-6 steps, where the ring distance rules spots out), loud out-of-reach noise, and a few wild ones
rng = random.Random(20261105)
synth = []


def add(counts, turns, steps, first, why):
    synth.append(night(counts, turns, steps, first, why=why))


def reach_list(turns, steps):
    return [s for s in range(N) if in_reach(s, turns, steps)]


def epic_of(counts, turns, steps):
    shots = sum(counts)
    c = sorted([s for s in reach_list(turns, steps) if shots and counts[s] * 100 >= shots], key=lambda s: (-counts[s], s))
    return c[-1] if c else None


# hand-made cases (turns, steps chosen so the start and the reach are easy to see)
add([4000] + [0] * 15, 16, 2, 0, 'start 0, 2 steps: spots 14, 0, 2; only 0 lands: n = 1, Legendary on the first shot')
add([4000] + [0] * 15, 16, 2, 0, 'same')
add([3000, 0, 1000] + [0] * 13, 16, 2, 0, 'n = 2: spot 0 Rare, spot 2 Epic (first shot on 0)')
add([3000, 0, 1000] + [0] * 13, 16, 2, 2, 'n = 2: the first shot on the Epic spot 2: Legendary')
add([39, 0, 39] + [0] * 11 + [3922, 0], 16, 2, 14, '39 of 4,000 is under 1 %: n = 1 (spot 14)')
add([40, 0, 40] + [0] * 11 + [3920, 0], 16, 2, 0, '40 of 4,000 is exactly 1 %: n = 3; equal 40s: the higher spot (2) is Epic')
add([40, 0, 40] + [0] * 11 + [3920, 0], 16, 2, 2, 'the same with the first shot on spot 2: Legendary')
add([250] * 16, 3817, 10, 7, 'every spot equal: in reach the odd spots; ties ranked by spot number, 15 is Epic')
add([250] * 16, 3817, 10, 15, 'the same, the first shot on 15: Legendary')
add([1] + [0] * 15, 16, 2, 0, 'one shot in all: n = 1, Legendary')
add([0] * 8 + [900, 0, 1000] + [0] * 5, 9, 1, 8, '1 step from spot 9: only 8 and 10 are in reach; 10 (1000) Rare, 8 (900) Epic = the first shot: Legendary')
add([0] * 8 + [900, 0, 1000] + [0] * 5, 9, 1, 10, 'the same, the first shot on 10 (Rare): no Legendary, 8 Epic')
add([500] * 16, 9, 1, 3, '1 step: spots 3..7 and 11..15 have landings but are out of reach (distance)')
add([0, 0, 0, 3000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1000], 16, 3, 15, 'start 0, 3 steps: spot 3 in reach; 15 in reach; 5 would be out')
add([700, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 1600], 16, 4, 4, 'ties among the 100s: the higher spot ranks lower')
for shots, edge in ((333, 4), (1000, 10), (4001, 41), (100, 1), (12345, 124)):
    c = [0] * N
    c[0], c[2], c[14], c[4] = edge, edge - 1, edge + 1, shots - 3 * edge
    add(c, 16, 4, 0, f'1 % line at {shots} shots: {edge} catches, {edge - 1} does not')

# random nights
modes = ['chip'] * 6 + ['ties'] * 2 + ['edge'] * 2 + ['loud_out', 'few', 'few', 'short', 'short', 'wild']
for i in range(420):
    mode = modes[i % len(modes)]
    steps = rng.randint(1, 6) if mode == 'short' else (rng.randint(1, 7) if rng.random() < 0.5 else rng.randint(1, 16))
    turns = rng.randint(steps, 30000) if rng.random() < 0.9 else rng.randint(steps, 2 ** 32 - 1)
    reach = reach_list(turns, steps)
    out_r = [s for s in range(N) if s not in reach]
    counts = [0] * N
    if mode in ('chip', 'short'):
        shots = rng.choice([4000, 4000, 4000, 1000, 2500, 8000, 333])
        wt = [rng.random() ** 2 for _ in reach]
        tot = sum(wt) or 1
        noise = rng.randint(0, shots // 5)
        for s, x in zip(reach, wt): counts[s] = int((shots - noise) * x / tot)
        for _ in range(noise): counts[rng.randrange(N)] += 1
    elif mode == 'ties':
        v = rng.choice([[40, 40, 40], [100, 100, 7], [250, 250, 250, 39], [1, 1, 0], [500, 500, 40, 40]])
        for s in range(N): counts[s] = rng.choice(v)
    elif mode == 'edge':
        shots = rng.choice([4000, 1000, 100, 3999, 4001, 12345])
        edge = -(-shots // 100)
        for s in reach: counts[s] = rng.choice([edge, edge - 1, edge + 1, edge * 3, 0])
        for _ in range(max(shots - sum(counts), 0)): counts[rng.choice(out_r or reach)] += 1
    elif mode == 'loud_out':
        for s in reach: counts[s] = rng.randint(0, 400)
        if out_r: counts[rng.choice(out_r)] = rng.randint(2000, 60000)
    elif mode == 'few':
        for s in rng.sample(reach, rng.randint(0, min(5, len(reach)))): counts[s] = rng.randint(50, 900)
        for s in range(N):
            if counts[s] == 0: counts[s] = rng.randint(0, 3)
    else:
        for s in range(N): counts[s] = rng.choice([0, rng.randint(0, 65535), rng.randint(0, 100)])
    counts = [min(c, 65535) for c in counts]
    if sum(counts) == 0: counts[rng.randrange(N)] = 1
    landed = [s for s in range(N) if counts[s] > 0]
    e = epic_of(counts, turns, steps)
    first = e if e is not None and rng.random() < 0.4 else rng.choice(landed)
    add(counts, turns, steps, first, mode)

# the rule's shape on every night: at most one Epic-or-Legendary, one Rare (n >= 2), two Uncommon (n >= 4), the rest Common
per_n, legend = {}, 0
for x in real + synth:
    t = x['tiers']; n = sum(1 for v in t if v)
    per_n[n] = per_n.get(n, 0) + 1
    assert t.count(4) + t.count(5) == (1 if n else 0) and t.count(3) == (1 if n >= 2 else 0) and t.count(2) == max(0, min(2, n - 2)) \
        and t.count(1) == max(0, n - 4), x
    assert all(x['reach'][s] for s in range(N) if t[s]), 'only spots in reach catch'
    legend += 5 in t
assert all(per_n.get(n, 0) >= 3 for n in range(9)), per_n
assert legend >= 30, legend
assert len(real) == 9, [x['file'] for x in real]
print(json.dumps({'source': 'wheel/test/tier_ref.py', 'real': real, 'synth': synth}, separators=(',', ':')))
