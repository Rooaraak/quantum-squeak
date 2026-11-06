"""Fetch a queued Quantum Wheel job (submitted with wheel_run.py --submit-only, record in pending/) once IBM has run it,
and save it exactly like wheel_run.py would (health gate: twin test < 79 % -> rejected/). No chip time is used.
  python3 wheel_fetch.py            (every pending record; leaves unfinished ones)"""
import glob, hashlib, json, os, sys, warnings
warnings.filterwarnings('ignore')
here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
import wheel
from qiskit_ibm_runtime import QiskitRuntimeService
svc = QiskitRuntimeService(instance='Test')
CARD = {0: 'FUR', 1: 'HAT'}; PAIRS = [(0, 0), (0, 1), (1, 0), (1, 1)]
for f in sorted(glob.glob(os.path.join(here, 'pending', '*.json'))):
    rec = json.load(open(f)); job = svc.job(rec['job_id']); st = str(job.status())
    if 'DONE' not in st:
        print(rec['night'], rec['job_id'], st); continue
    res = job.result()
    c0 = list(res[0].data.keys())[0]; counts = [0] * 16
    shots = res[0].data[c0].get_bitstrings()
    for b in shots: counts[int(b, 2)] += 1
    out = {'kind': 'quantum_wheel', 'recipe': rec.get('recipe', 'wheel_spec.md v1.1'), 'dd_twirl': rec.get('dd_twirl', False), 'night': rec['night'], 'core': rec['core'], 'rounds': rec['rounds'], 'steps': rec['steps'],
           'backend': rec['backend'], 'job_id': rec['job_id'], 'wheel_shots': rec['wheel_shots'], 'wheel_2q_gates': rec['wheel_2q_gates'], 'counts': counts,
           'shots_in_order': [int(b, 2) for b in shots], 'perfect': wheel.ideal_walk(rec['steps']), 'normal': wheel.normal_walk(rec['steps']), 'twin': []}
    for i, (x, y) in enumerate(PAIRS, start=1):
        ci = list(res[i].data.keys())[0]; ab = [b[::-1] for b in res[i].data[ci].get_bitstrings()]
        out['twin'].append({'a_card': CARD[x], 'b_card': CARD[y], 'shots': len(ab), 'wins': sum(1 for s in ab if (int(s[0]) ^ int(s[1])) == (x & y))})
    m = job.metrics(); out['quantum_seconds'] = (m.get('usage') or {}).get('quantum_seconds'); out['timestamps'] = {k: str(v) for k, v in (m.get('timestamps') or {}).items()}
    out['usage_remaining_before'] = rec.get('usage_remaining_before'); out['usage_remaining_after'] = svc.usage().get('usage_remaining_seconds')
    out['twin_qubits'] = rec['twin_qubits']; out['healthy'] = wheel.chip_healthy(out['twin']); out['fetched_later'] = True
    dest = here if out['healthy'] else os.path.join(here, 'rejected'); os.makedirs(dest, exist_ok=True)
    fn = os.path.join(dest, f"wheel-{rec['night']}-{rec['backend']}-{rec['job_id']}.json"); json.dump(out, open(fn, 'w'))
    os.rename(f, f + '.done')
    tvd = lambda a, b: 0.5 * sum(abs(p - q) for p, q in zip(a, b)); chip = [x / rec['wheel_shots'] for x in counts]
    print(rec['night'], rec['job_id'], 'HEALTHY' if out['healthy'] else 'REJECTED', f"twins {100 * wheel.twin_score(out['twin']):.1f}%",
          f"chip vs perfect {tvd(chip, out['perfect']):.3f} vs normal {tvd(chip, out['normal']):.3f}", '->', os.path.relpath(fn, here))
