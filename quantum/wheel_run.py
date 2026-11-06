"""Run one night of the Quantum Wheel on IBM (recipe v1, wheel_spec.md): his real night from the chain
(data/chain-nights.json, built by data/night-from-chain.mjs) -> the wheel circuit, 4,000 shots, plus the twin test
(CHSH, 4 card pairs x 250 shots) in the SAME job. Needs the owner's OK for the chip time (~3-5 s).
  python3 wheel_run.py --night 2026-11-04 [--backend ibm_fez] [--dry] [--sim --out <dir>]"""
import json, math, os, sys, time, warnings
warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wheel
from qiskit import QuantumCircuit, transpile

arg = lambda k, d=None: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
NIGHT, BACKEND, WHEEL_SHOTS, TWIN_SHOTS = arg('--night'), arg('--backend', 'ibm_fez'), 4000, 250
if not NIGHT: sys.exit('need --night YYYY-MM-DD')
here = os.path.dirname(os.path.abspath(__file__))
n = json.load(open(os.path.join(here, '../data/chain-nights.json')))['nights'].get(NIGHT)
if not n or not n.get('complete'): sys.exit(f'night {NIGHT} not in chain-nights.json or not complete (run data/night-from-chain.mjs)')
steps = wheel.steps_from_w([r['turns'] for r in n['rounds']])
if not steps: sys.exit('he did not run that night: nothing to send')
print('night', NIGHT, 'core', n['core'], 'active rounds', len(n['rounds']), 'steps', steps)

A_ANG, B_ANG, PAIRS, CARD = {0: 0.0, 1: math.pi / 2}, {0: math.pi / 4, 1: -math.pi / 4}, [(0, 0), (0, 1), (1, 0), (1, 1)], {0: 'FUR', 1: 'HAT'}
def twin(x, y):   # same as dawn_run.py / twin_run.py, so the proof numbers stay comparable
    qc = QuantumCircuit(2, 2, name=f'twin_{CARD[x]}_{CARD[y]}'); qc.h(0); qc.cx(0, 1); qc.ry(A_ANG[x], 0); qc.ry(B_ANG[y], 1); qc.measure([0, 1], [0, 1]); return qc

from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
svc = QiskitRuntimeService(instance='Test'); be = svc.backend(BACKEND)
left = svc.usage().get('usage_remaining_seconds'); print('chip seconds left this period:', left)
if left is not None and left < 20: sys.exit('under 20 s left: not sending')
items = [('wheel', None, wheel.build_circuit(steps), WHEEL_SHOTS)] + [('twin', (x, y), twin(x, y), TWIN_SHOTS) for x, y in PAIRS]
best = None
for seed in range(8):    # pick the transpile with the fewest 2-qubit gates (less noise)
    t = transpile(items[0][2], backend=be, optimization_level=3, seed_transpiler=seed)
    n2 = sum(1 for i in t.data if i.operation.num_qubits == 2)
    if best is None or n2 < best[0]: best = (n2, seed, t)
# health check on the wheel's OWN hardware: the twin test runs on a pair of qubits the wheel's CZ gates use
cz = next(i for i in best[2].data if i.operation.num_qubits == 2)
pair = [best[2].find_bit(q).index for q in cz.qubits]
tq = [best[2]] + transpile([c for _, _, c, _ in items[1:]], backend=be, optimization_level=3, seed_transpiler=11, initial_layout=pair)
print('twin test on the wheel qubits', pair)
print('circuits', len(tq), 'shots', sum(s for *_, s in items), 'wheel 2q gates', best[0], 'depth', best[2].depth(), 'seed', best[1])
if '--dry' in sys.argv: sys.exit(0)
NO_DD = '--no-dd' in sys.argv     # v1.2: dynamical decoupling + gate twirling on by default (long idle times = decoherence)
SIM = '--sim' in sys.argv          # local rehearsal of the whole path on IBM's noise model: no chip time, writes to --out
if SIM:
    from qiskit_aer import AerSimulator
    mode, here = AerSimulator.from_backend(be), arg('--out') or sys.exit('--sim needs --out <dir>')
else: mode = be
sampler = SamplerV2(mode=mode)
if not SIM and not NO_DD:
    sampler.options.dynamical_decoupling.enable = True; sampler.options.dynamical_decoupling.sequence_type = 'XpXm'
    sampler.options.twirling.enable_gates = True; sampler.options.twirling.num_randomizations = 'auto'
job = sampler.run([(c, None, s) for c, (_, _, _, s) in zip(tq, items)])
print('job', job.job_id(), 'submitted'); sys.stdout.flush()
if '--submit-only' in sys.argv and not SIM:   # IBM queues can be long: record the job and fetch it later with wheel_fetch.py
    os.makedirs(os.path.join(here, 'pending'), exist_ok=True)
    json.dump({'night': NIGHT, 'backend': BACKEND, 'job_id': job.job_id(), 'recipe': 'wheel_spec.md ' + wheel.RECIPE, 'dd_twirl': not NO_DD, 'steps': steps, 'core': n['core'], 'rounds': [[r['id'], r['turns']] for r in n['rounds']],
               'wheel_shots': WHEEL_SHOTS, 'wheel_2q_gates': best[0], 'twin_qubits': pair, 'usage_remaining_before': left},
              open(os.path.join(here, 'pending', f'{NIGHT}-{job.job_id()}.json'), 'w'))
    print('submitted only: fetch later with wheel_fetch.py'); sys.exit(0)
res = job.result()
bits = res[0].data[tq[0].cregs[0].name].get_bitstrings()
counts = [0] * 16
for b in bits: counts[int(b, 2)] += 1                       # classical bit i = position bit i, qiskit prints c3..c0
out = {'kind': 'quantum_wheel', 'recipe': 'wheel_spec.md ' + wheel.RECIPE, 'dd_twirl': not NO_DD, 'night': NIGHT, 'core': n['core'], 'rounds': [[r['id'], r['turns']] for r in n['rounds']],
       'steps': steps, 'backend': BACKEND, 'job_id': job.job_id(), 'wheel_shots': WHEEL_SHOTS, 'wheel_2q_gates': best[0],
       'counts': counts, 'shots_in_order': [int(b, 2) for b in bits], 'perfect': wheel.ideal_walk(steps), 'normal': wheel.normal_walk(steps), 'twin': []}
for i, (kind, key, _, shots) in enumerate(items[1:], start=1):
    x, y = key; ab = [b[::-1] for b in res[i].data[tq[i].cregs[0].name].get_bitstrings()]
    wins = sum(1 for s in ab if (int(s[0]) ^ int(s[1])) == (x & y))
    out['twin'].append({'a_card': CARD[x], 'b_card': CARD[y], 'shots': len(ab), 'wins': wins})
m = job.metrics() if hasattr(job, 'metrics') and not SIM else {}
try: out['quantum_seconds'] = (m.get('usage') or {}).get('quantum_seconds')
except Exception: out['quantum_seconds'] = None
out['timestamps'] = {k: str(v) for k, v in (m.get('timestamps') or {}).items()}
time.sleep(0 if SIM else 5)
try: out['usage_remaining_after'] = svc.usage().get('usage_remaining_seconds')
except Exception: out['usage_remaining_after'] = None
out['usage_remaining_before'] = left
out['twin_qubits'] = pair
tw = wheel.twin_score(out['twin']); out['healthy'] = wheel.chip_healthy(out['twin'])
if not out['healthy']: os.makedirs(os.path.join(here, 'rejected'), exist_ok=True)
fn = os.path.join(here, '' if out['healthy'] else 'rejected', f'wheel-{NIGHT}-{BACKEND}-{job.job_id()}.json'); json.dump(out, open(fn, 'w'))
tvd = lambda a, b: 0.5 * sum(abs(x - y) for x, y in zip(a, b))
chip = [c / WHEEL_SHOTS for c in counts]
print(f"saved {os.path.basename(fn)}  chip vs perfect {tvd(chip, out['perfect']):.3f}  chip vs normal {tvd(chip, out['normal']):.3f}  twins {100 * tw:.1f}%  left {out['usage_remaining_after']}")
print('spot shares', ' '.join(f'{s}:{100 * c:.1f}' for s, c in enumerate(chip)))
if not out['healthy']:
    print(f'REJECTED: twin test {100 * tw:.1f}% is under the {100 * wheel.HEALTH_MIN:.0f}% health gate: the chip misbehaved; saved under rejected/, rerun later or on another backend')
    sys.exit(3)
