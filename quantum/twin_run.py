"""Quantum Hatch Twin Lab gate: the CHSH card game on real IBM hardware.
Two linked qubits (H on A, CX A->B). Each round A gets a card x (FUR=0, HAT=1), B gets y (FUR=0, HAT=1).
A turns RY(0) for FUR or RY(pi/2) for HAT; B turns RY(+pi/4) for FUR or RY(-pi/4) for HAT; both are measured.
They win if a == b, except HAT/HAT, where they must differ (a xor b == x and y).
Any fixed plan without linked qubits wins at most 75 % (averaged over the 4 card pairs). A perfect chip wins 85.4 % on every pair.
Gate: average of the 4 pairs >= 79 % on the real chip, or the Twin bar is dropped.
  python3 twin_run.py ibm_fez 1000 [--dry]"""
import json, sys, time, math
from qiskit import QuantumCircuit, transpile
from qiskit.quantum_info import Statevector

BACKEND = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else 'ibm_fez'
SHOTS = int(sys.argv[2]) if len(sys.argv) > 2 and not sys.argv[2].startswith('--') else 1000
A_ANG = {0: 0.0, 1: math.pi / 2}            # A: FUR, HAT
B_ANG = {0: math.pi / 4, 1: -math.pi / 4}   # B: FUR, HAT
PAIRS = [(0, 0), (0, 1), (1, 0), (1, 1)]
NAME = {0: 'FUR', 1: 'HAT'}

def circuit(x, y, measure=True):
    qc = QuantumCircuit(2, 2, name=f'twin_{NAME[x]}_{NAME[y]}')
    qc.h(0); qc.cx(0, 1)
    qc.ry(A_ANG[x], 0); qc.ry(B_ANG[y], 1)
    if measure: qc.measure([0, 1], [0, 1])
    return qc

def win(bit_a, bit_b, x, y): return (bit_a ^ bit_b) == (x & y)

# 1) ideal check (no chip): every pair must win cos^2(pi/8) = 85.36 %
for x, y in PAIRS:
    p = Statevector(circuit(x, y, measure=False)).probabilities_dict()   # keys 'q1q0'
    w = sum(pr for k, pr in p.items() if win(int(k[1]), int(k[0]), x, y))
    print(f'ideal {NAME[x]}/{NAME[y]}: win {100 * w:.2f} %')
    assert abs(w - math.cos(math.pi / 8) ** 2) < 1e-9, 'ideal win must be 85.36 %'
# 2) no fixed plan beats 75 %: check all 16 deterministic plans
best = max(sum(win(pa[x], pb[y], x, y) for x, y in PAIRS) / 4 for pa in [(i >> 1 & 1, i & 1) for i in range(4)] for pb in [(j >> 1 & 1, j & 1) for j in range(4)])
print(f'best fixed plan wins {100 * best:.0f} %'); assert best == 0.75

from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
svc = QiskitRuntimeService(name='ibm-new-2026-11-06', instance='open-instance')
be = svc.backend(BACKEND)
circs = [circuit(x, y) for x, y in PAIRS]
tqs = transpile(circs, backend=be, optimization_level=3, seed_transpiler=7)
props = be.properties()
lays = [t.layout.final_index_layout()[:2] for t in tqs]
print('layouts', lays)
for t, lay in zip(tqs, lays):
    twoq = [ins for ins in t.data if ins.operation.num_qubits == 2]
    print(t.name, 'phys', lay, 'readout err %.4f / %.4f' % (props.readout_error(lay[0]), props.readout_error(lay[1])), '2q gates', len(twoq), 'depth', t.depth())
if '--dry' in sys.argv: sys.exit(0)
before = svc.usage().get('usage_remaining_seconds')
t0 = time.time()
job = SamplerV2(mode=be).run(tqs, shots=SHOTS)
print('job', job.job_id(), 'submitted'); sys.stdout.flush()
res = job.result()
pairs = []
for i, (x, y) in enumerate(PAIRS):
    bits = res[i].data[tqs[i].cregs[0].name].get_bitstrings()        # 'c1c0'
    shots = [b[::-1] for b in bits]                                  # -> 'ab' (q0 = A, q1 = B)
    wins = sum(1 for s in shots if win(int(s[0]), int(s[1]), x, y))
    counts = {k: shots.count(k) for k in ('00', '01', '10', '11')}
    pairs.append({'a_card': NAME[x], 'b_card': NAME[y], 'shots': len(shots), 'wins': wins, 'win_pct': round(100 * wins / len(shots), 2), 'counts_ab': counts, 'layout': lays[i], 'bits_ab': shots})
avg = sum(p['win_pct'] for p in pairs) / 4
m = job.metrics() if hasattr(job, 'metrics') else {}
try: qsec = (m.get('usage') or {}).get('quantum_seconds') or job.usage()
except Exception: qsec = None
time.sleep(5)
try: after = svc.usage().get('usage_remaining_seconds')
except Exception: after = None
out = {'backend': BACKEND, 'job_id': job.job_id(), 'shots_per_pair': SHOTS, 'pairs': pairs, 'avg_win_pct': round(avg, 2), 'gate_pct': 79,
       'gate_passed': avg >= 79, 'ideal_pct': round(100 * math.cos(math.pi / 8) ** 2, 2), 'classical_max_pct': 75,
       'quantum_seconds': qsec, 'usage_remaining_before': before, 'usage_remaining_after': after,
       'timestamps': {k: str(v) for k, v in (m.get('timestamps') or {}).items()},
       'circuit': 'H q0; CX q0->q1; RY(0|pi/2) on A (FUR|HAT); RY(+pi/4|-pi/4) on B (FUR|HAT); measure both. Win: a xor b == (x and y).'}
fn = f"twin-{BACKEND}-{job.job_id()}.json"; json.dump(out, open(fn, 'w'))
for p in pairs: print(f"{p['a_card']}/{p['b_card']}: {p['wins']}/{p['shots']} = {p['win_pct']} %  {p['counts_ab']}")
print(f'AVERAGE {avg:.2f} %  (gate 79 %, no plan beats 75 %, perfect chip 85.4 %)  -> {"PASS" if avg >= 79 else "FAIL"}')
print('saved', fn, 'wall secs %.1f' % (time.time() - t0), 'quantum_seconds', qsec, 'remaining', before, '->', after)
