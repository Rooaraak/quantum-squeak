"""Quantum Hatch: open real eggs on IBM hardware.
One 'wild egg' circuit = the game's chip(): 6 trait qubits (H), 2 check qubits (q6 = q0^q2, q7 = q1^q3 via CX),
16 fingerprint qubits (H). Every shot is one egg's 24 measured bits. Saves per-shot bitstrings + job facts."""
import json, sys, time, datetime
from qiskit import QuantumCircuit, transpile
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2

BACKEND = sys.argv[1] if len(sys.argv) > 1 else 'ibm_fez'
SHOTS = int(sys.argv[2]) if len(sys.argv) > 2 else 4096
qc = QuantumCircuit(24, 24, name='wild_egg')
for q in list(range(6)) + list(range(8, 24)): qc.h(q)
qc.cx(0, 6); qc.cx(2, 6); qc.cx(1, 7); qc.cx(3, 7)
qc.measure(range(24), range(24))

svc = QiskitRuntimeService(instance='Test')
be = svc.backend(BACKEND)
tq = transpile(qc, backend=be, optimization_level=3, seed_transpiler=7)
lay = tq.layout.final_index_layout() if tq.layout else list(range(24))
props = be.properties()
ro = {p: props.readout_error(p) for p in lay}
twoq = [(op.name, tuple(tq.find_bit(q).index for q in ins.qubits)) for ins in tq.data for op in [ins.operation] if op.num_qubits == 2]
print('layout', lay)
print('readout err max %.3f mean %.3f' % (max(ro.values()), sum(ro.values()) / 24))
print('2q gates', len(twoq), 'depth', tq.depth())
bad = [p for p, e in ro.items() if e > 0.05]
if bad: print('WARNING high readout qubits', bad)
if '--dry' in sys.argv: sys.exit(0)
t0 = time.time()
job = SamplerV2(mode=be).run([tq], shots=SHOTS)
print('job', job.job_id(), 'submitted'); sys.stdout.flush()
res = job.result()
bits = res[0].data[tq.cregs[0].name].get_bitstrings()   # each string is c23..c0
eggs = [b[::-1] for b in bits]                           # -> q0..q23
m = job.metrics() if hasattr(job, 'metrics') else {}
out = {'backend': BACKEND, 'job_id': job.job_id(), 'shots': SHOTS, 'layout': lay,
       'created': str(m.get('timestamps', {}).get('created', '')), 'finished': str(m.get('timestamps', {}).get('finished', '')),
       'quantum_seconds': (m.get('usage') or {}).get('quantum_seconds') or job.usage(), 'timestamps': {k: str(v) for k, v in (m.get('timestamps') or {}).items()}, 'readout_err': ro, 'eggs': eggs,
       'circuit': 'H on q0-5 and q8-23; CX q0->q6, q2->q6, q1->q7, q3->q7; measure all 24'}
fn = f"eggs-{BACKEND}-{job.job_id()}.json"; json.dump(out, open(fn, 'w'))
P = lambda idx: sum(int(e[i]) for e in eggs for i in idx) / (len(eggs) * len(idx))
fail = sum(1 for e in eggs if e[6] != str(int(e[0]) ^ int(e[2])) or e[7] != str(int(e[1]) ^ int(e[3]))) / len(eggs)
print('saved', fn, 'secs', time.time() - t0)
print('trait P1 %.3f  fingerprint P1 %.3f  check-fail (glitch) %.2f%%  quantum_seconds %s' % (P(range(6)), P(range(8, 24)), 100 * fail, out['quantum_seconds']))
print('timestamps', out['created'], out['finished'])
