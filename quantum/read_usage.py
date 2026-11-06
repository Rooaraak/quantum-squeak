# Reads IBM's own record of past jobs (no chip time used): usage seconds + timestamps, and stores them in the result files.
#   python3 read_usage.py
import json, glob
from qiskit_ibm_runtime import QiskitRuntimeService
svc = QiskitRuntimeService(instance='Test')
for fn in sorted(glob.glob('eggs-*.json') + glob.glob('grover-*.json')):
    d = json.load(open(fn)); job = svc.job(d['job_id'])
    m = job.metrics() or {}
    try: u = job.usage()
    except Exception as e: u = None
    ts = m.get('timestamps', {}) or {}
    usage = m.get('usage', {}) or {}
    d['quantum_seconds'] = usage.get('quantum_seconds', u); d['usage_seconds'] = usage.get('seconds', u)
    d['timestamps'] = {k: str(v) for k, v in ts.items()}
    json.dump(d, open(fn, 'w'))
    print(fn, 'quantum_seconds', d['quantum_seconds'], 'usage', d['usage_seconds'], d['timestamps'])
