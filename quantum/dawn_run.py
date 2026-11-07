"""Quantum Hatch DAWN RUN: the one IBM job a real night gets, sent the morning after Squeektoshi's night.
One job carries everything the game needs from that night:
  1. egg shots   - the 24-qubit egg circuit (gold 1-6, 2 checks, 16 fingerprint), EGG_SHOTS shots
  2. board pools - real Grover search on 4 qubits, 16 targets x 1..3 boosts, POOL_SHOTS shots each
  3. twin rounds - the Twin Lab card game (CHSH), 4 card pairs x TWIN_SHOTS shots
Refuses a rest night (his longest run under 1 h = 6 rounds) unless --force. Needs the owner's OK for the chip time (~5 s).
  python3 dawn_run.py --night 2026-11-05 [--backend ibm_fez] [--dry] [--force]"""
import json, sys, time, math, os
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import ZGate

arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
NIGHT = arg('--night'); BACKEND = arg('--backend', 'ibm_fez')
EGG_SHOTS, POOL_SHOTS, TWIN_SHOTS, KS = 2048, 32, 250, (1, 2, 3)
if not NIGHT: sys.exit('need --night YYYY-MM-DD (the Squeek day = date of its 12:00 UTC start)')

# ---- the night must be real and long enough
night = None
for fn in ('../data/nights-live.json', '../data/nights-rounds.json'):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), fn)
    if os.path.exists(p):
        n = json.load(open(p)).get('nights', {}).get(NIGHT)
        if n and n.get('complete'): night = {'date': NIGHT, 'run': n['run'], 'active': n['active'], 'work': n.get('turns'), 'source': os.path.basename(fn)}; break
if not night: sys.exit(f'no complete night {NIGHT} in nights-live.json / nights-rounds.json')
print('night', night)
if night['run'] < 6 and '--force' not in sys.argv: sys.exit(f"rest night: longest run {night['run']} rounds (< 6 = 1 h). No job is sent.")

# ---- circuits (same as eggs_run.py, grover_run.py, twin_run.py)
def egg():
    qc = QuantumCircuit(24, 24, name='wild_egg')
    for q in list(range(6)) + list(range(8, 24)): qc.h(q)
    qc.cx(0, 6); qc.cx(2, 6); qc.cx(1, 7); qc.cx(3, 7); qc.measure(range(24), range(24)); return qc
MCZ = ZGate().control(3)
def flips(qc, t):
    for q in range(4):
        if not (t >> q) & 1: qc.x(q)
def grover(t, k):
    qc = QuantumCircuit(4, 4, name=f'g{t}_{k}'); qc.h(range(4))
    for _ in range(k):
        flips(qc, t); qc.append(MCZ, [0, 1, 2, 3]); flips(qc, t)
        qc.h(range(4)); qc.x(range(4)); qc.append(MCZ, [0, 1, 2, 3]); qc.x(range(4)); qc.h(range(4))
    qc.measure(range(4), range(4)); return qc
A_ANG, B_ANG, PAIRS, CARD = {0: 0.0, 1: math.pi / 2}, {0: math.pi / 4, 1: -math.pi / 4}, [(0, 0), (0, 1), (1, 0), (1, 1)], {0: 'FUR', 1: 'HAT'}
def twin(x, y):
    qc = QuantumCircuit(2, 2, name=f'twin_{CARD[x]}_{CARD[y]}'); qc.h(0); qc.cx(0, 1); qc.ry(A_ANG[x], 0); qc.ry(B_ANG[y], 1); qc.measure([0, 1], [0, 1]); return qc

from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
svc = QiskitRuntimeService(name='ibm-new-2026-11-06', instance='open-instance'); be = svc.backend(BACKEND)
left = svc.usage().get('usage_remaining_seconds'); print('chip seconds left this period:', left)
if left is not None and left < 20: sys.exit('under 20 s left: not sending')
items = [('egg', None, egg(), EGG_SHOTS)] + [('pool', (t, k), grover(t, k), POOL_SHOTS) for t in range(16) for k in KS] + [('twin', (x, y), twin(x, y), TWIN_SHOTS) for x, y in PAIRS]
tq = transpile([c for _, _, c, _ in items], backend=be, optimization_level=3, seed_transpiler=11)
print('circuits', len(tq), 'shots', sum(s for *_, s in items), 'egg 2q gates', sum(1 for i in tq[0].data if i.operation.num_qubits == 2))
if '--dry' in sys.argv: sys.exit(0)

sent = time.time()
job = SamplerV2(mode=be).run([(c, None, s) for c, (_, _, _, s) in zip(tq, items)])
print('job', job.job_id(), 'submitted'); sys.stdout.flush()
res = job.result()
out = {'kind': 'dawn_run', 'night': night, 'backend': BACKEND, 'job_id': job.job_id(), 'egg_shots': EGG_SHOTS, 'pool_shots': POOL_SHOTS, 'twin_shots': TWIN_SHOTS,
       'eggs': [], 'pools': {}, 'twin': []}
for i, (kind, key, _, shots) in enumerate(items):
    bits = res[i].data[tq[i].cregs[0].name].get_bitstrings()
    if kind == 'egg': out['eggs'] = [b[::-1] for b in bits]                                    # q0..q23
    elif kind == 'pool': out['pools'][f'{key[0]}_{key[1]}'] = [int(b, 2) for b in bits]       # q0 = lowest bit
    else:
        x, y = key; ab = [b[::-1] for b in bits]; wins = sum(1 for s in ab if (int(s[0]) ^ int(s[1])) == (x & y))
        out['twin'].append({'a_card': CARD[x], 'b_card': CARD[y], 'shots': len(ab), 'wins': wins, 'bits_ab': ab})
m = job.metrics() if hasattr(job, 'metrics') else {}
try: out['quantum_seconds'] = (m.get('usage') or {}).get('quantum_seconds') or job.usage()
except Exception: out['quantum_seconds'] = None
out['timestamps'] = {k: str(v) for k, v in (m.get('timestamps') or {}).items()}; out['created'] = out['timestamps'].get('created', '')
time.sleep(5)
try: out['usage_remaining_after'] = svc.usage().get('usage_remaining_seconds')
except Exception: out['usage_remaining_after'] = None
out['usage_remaining_before'] = left
fn = f'dawn-{NIGHT}-{BACKEND}-{job.job_id()}.json'; json.dump(out, open(fn, 'w'))
fail = sum(1 for e in out['eggs'] if e[6] != str(int(e[0]) ^ int(e[2])) or e[7] != str(int(e[1]) ^ int(e[3]))) / len(out['eggs'])
hit = {k: sum(sum(1 for o in out['pools'][f'{t}_{k}'] if o == t) for t in range(16)) / (16 * POOL_SHOTS) for k in KS}
tw = sum(p['wins'] for p in out['twin']) / sum(p['shots'] for p in out['twin'])
print(f"saved {fn}  misprints {100 * fail:.2f}%  search hit {', '.join(f'k{k} {100 * v:.0f}%' for k, v in hit.items())}  twins {100 * tw:.1f}%  chip time {out['quantum_seconds']} s  left {out['usage_remaining_after']}")
