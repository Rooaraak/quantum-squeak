"""The Quantum Wheel (recipe v1, wheel_spec.md): Squeektoshi's real night programs a quantum walk on a ring of 16 spots.
Pure Python + numpy for the walks (the page's JS copy must match data/wheel-vectors.json); qiskit only for the circuit."""
import math
import numpy as np

N, CAP, MAX_TURNS = 16, 10, 700
RECIPE = 'v1.2'   # v1.2 (5 Nov): at most 10 steps (v1.1, the 29 Oct - 4 Nov archive, used 16): see wheel_spec.md
COMMON, UNCOMMON, RARE, EPIC, LEGENDARY = 1, 2, 3, 4, 5   # tier codes as the contract (0 = got away)

def steps_from_w(w, cap=CAP):
    """Active rounds (turns > 0) in order; more than `cap`: `cap` consecutive groups (earlier take the extra), mean half up."""
    a = [t for t in w if t > 0]
    if len(a) <= cap: return a
    q, r = divmod(len(a), cap); out, i = [], 0
    for g in range(cap):
        n = q + (1 if g < r else 0); grp = a[i:i + n]; i += n
        out.append(int(math.floor(sum(grp) / n + 0.5)))
    return out

def angle(turns):
    return math.pi * min(turns, MAX_TURNS) / MAX_TURNS

def _coin(theta):
    c, s = math.cos(theta / 2), math.sin(theta / 2)
    return np.array([[c, -s], [s, c]], dtype=complex)            # RY(theta): |0> -> c|0> + s|1>

def ideal_walk(steps, trace=False):
    """Perfect quantum walk in the position basis. Returns P(spot) (and per-step P if trace)."""
    psi = np.zeros((2, N), dtype=complex); psi[0, 0] = 1 / math.sqrt(2); psi[1, 0] = 1j / math.sqrt(2)
    hist = []
    for t in steps:
        psi = _coin(angle(t)) @ psi
        psi = np.stack([np.roll(psi[0], -1), np.roll(psi[1], 1)])   # coin 0 -> spot-1, coin 1 -> spot+1
        if trace: hist.append((np.abs(psi) ** 2).sum(0).tolist())
    p = (np.abs(psi) ** 2).sum(0).tolist()
    return (p, hist) if trace else p

def normal_walk(steps, trace=False):
    """The same coin looked at after every step: a plain random walk (keep direction cos^2, turn round sin^2)."""
    pr = np.zeros((2, N)); pr[0, 0] = pr[1, 0] = 0.5; hist = []
    for t in steps:
        k, f = math.cos(angle(t) / 2) ** 2, math.sin(angle(t) / 2) ** 2
        pr = np.stack([k * pr[0] + f * pr[1], f * pr[0] + k * pr[1]])
        pr = np.stack([np.roll(pr[0], -1), np.roll(pr[1], 1)])
        if trace: hist.append(pr.sum(0).tolist())
    p = pr.sum(0).tolist()
    return (p, hist) if trace else p

def build_circuit(steps, measure=True):
    """qubit 0 = coin, qubits 1-4 = position bits 0-3; shift in the Fourier basis, one inverse QFT at the end."""
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import QFTGate
    qc = QuantumCircuit(5, 4 if measure else 0, name='quantum_wheel')
    pos = [1, 2, 3, 4]
    qc.h(0); qc.s(0)                                              # coin (|0> + i|1>)/sqrt2
    qc.h(pos)                                                     # spot 0 in the Fourier basis
    for t in steps:
        qc.ry(angle(t), 0)
        for j, q in enumerate(pos):
            phi = 2 * math.pi * (2 ** j) / N
            if j == 3: qc.z(q); continue                          # e^{+-i pi} = -1 either way: no coin needed
            qc.p(-phi, q); qc.cp(2 * phi, 0, q)
    qc.append(QFTGate(4).inverse(), pos)
    if measure: qc.measure(pos, range(4))
    return qc

def ring_distance(a, b):
    d = abs(a - b) % N
    return min(d, N - d)

def in_reach(spot, turns, steps):
    """Quantum Catch reach (contracts/src/QuantumCatch.sol, cf509b4): his start is spot turns % 16 (the v1.1 ring turn)
    and every step moves the walk one spot, so after `steps` steps it can only land on spots of the right parity
    ((spot + turns + steps) even) at most `steps` spots from his start around the ring."""
    return (spot + turns + steps) % 2 == 0 and ring_distance(spot, turns % N) <= steps

def tiers_of(counts, turns, steps, first):
    """The owner's rank rule (5 Nov; QuantumCatch.tiersOf): counts = landings per SPOT (already turned), first = the SPOT
    of the chip's very first shot (spot_of(shots_in_order[0], turns % 16)). Catchable = in reach AND at least 1 % of the
    shots; ranked by landings, most first, ties: the lower spot first; with n of them, rank r: Epic r = n, Rare r = n - 1,
    Uncommon r = n - 3 or n - 2, Common r <= n - 4; Legendary = the Epic spot when the first shot landed on it. Returns
    the tier code per spot (0 = got away; out of reach always)."""
    shots = sum(counts)
    order = sorted((s for s in range(N) if shots and in_reach(s, turns, steps) and counts[s] * 100 >= shots),
                   key=lambda s: (-counts[s], s))
    n, out = len(order), [0] * N
    for r, s in enumerate(order, 1):
        out[s] = (LEGENDARY if s == first else EPIC) if r == n else RARE if r == n - 1 else UNCOMMON if r >= n - 3 else COMMON
    return out

def looks(spot):
    return {'hat': spot & 1, 'glasses': (spot >> 1) & 1, 'neckwear': (spot >> 2) & 1, 'face': (spot >> 3) & 1}

HEALTH_MIN = 0.79   # twin test (CHSH): fixed plans max 75 %, perfect chip ~85.4 %; under 79 % the chip misbehaved: reject the run

def twin_score(pairs):
    return sum(p['wins'] for p in pairs) / sum(p['shots'] for p in pairs)

def chip_healthy(pairs):
    return twin_score(pairs) >= HEALTH_MIN

# v1.1 (5 Nov): with the 16-step cap almost every night has an even number of steps, so the walk only reaches spots of one
# parity and the same half of the ring would be dark every night (parity, not interference: the normal hamster can't
# reach them either). The ring is therefore turned by his night: spot = (position + total turns) mod 16. The walk is the
# same on every turn of the ring (translation invariance), so this is exactly the chip's result read from his own start.
def ring_turn(turns_per_round):
    return int(sum(turns_per_round)) % N

def spot_of(position, turn):
    return (position + turn) % N

def turned(p, turn):
    out = [0.0] * N
    for pos, v in enumerate(p): out[spot_of(pos, turn)] = v
    return out
