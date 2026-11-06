"""Quantum Hatch boost: real Grover search on 4 qubits. For every target t (0..15) and k = 0..6 iterations,
measure 300 shots on IBM hardware. In the game, an egg's 16 possible hamsters = the 16 outcomes; boosting k times
toward the one you want samples a real shot from pool (t, k)."""
import json, sys, time
from qiskit import QuantumCircuit, transpile
from qiskit.circuit.library import ZGate
from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2
BACKEND = sys.argv[1] if len(sys.argv) > 1 else 'ibm_fez'; SHOTS = 300; KS = range(7)
MCZ = ZGate().control(3)
def flips(qc, t):
    for q in range(4):
        if not (t >> q) & 1: qc.x(q)
def grover(t, k):
    qc = QuantumCircuit(4, 4, name=f'g{t}_{k}'); qc.h(range(4))
    for _ in range(k):
        flips(qc, t); qc.append(MCZ, [0, 1, 2, 3]); flips(qc, t)          # oracle: phase-flip |t>
        qc.h(range(4)); qc.x(range(4)); qc.append(MCZ, [0, 1, 2, 3]); qc.x(range(4)); qc.h(range(4))  # diffusion
    qc.measure(range(4), range(4)); return qc
svc = QiskitRuntimeService(instance='Test'); be = svc.backend(BACKEND)
circs = [grover(t, k) for t in range(16) for k in KS]
tq = transpile(circs, backend=be, optimization_level=3, seed_transpiler=11)
cz = [sum(1 for i in c.data if i.operation.num_qubits == 2) for c in tq]
print('circuits', len(tq), '2q gates k=0..6 (target 0):', cz[:7], 'max', max(cz))
lay = tq[7].layout.final_index_layout(); print('layout (t1,k0)', lay)
if '--dry' in sys.argv: sys.exit(0)
job = SamplerV2(mode=be).run(tq, shots=SHOTS); print('job', job.job_id(), 'submitted'); sys.stdout.flush()
res = job.result(); m = job.metrics() if hasattr(job, 'metrics') else {}
pools = {}
for i, (t, k) in enumerate([(t, k) for t in range(16) for k in KS]):
    bits = res[i].data[tq[i].cregs[0].name].get_bitstrings()          # c3..c0
    pools[f'{t}_{k}'] = [int(b, 2) for b in bits]                      # outcome as integer (q0 = lowest bit)
out = {'backend': BACKEND, 'job_id': job.job_id(), 'shots': SHOTS, 'quantum_seconds': (m.get('usage') or {}).get('quantum_seconds') or job.usage(), 'timestamps': {k: str(v) for k, v in (m.get('timestamps') or {}).items()}, 'created': str(m.get('timestamps', {}).get('created', '')),
       'two_qubit_gates_target0': cz[:7], 'pools': pools}
fn = f'grover-{BACKEND}-{job.job_id()}.json'; json.dump(out, open(fn, 'w'))
for k in KS:
    p = sum(sum(1 for o in pools[f'{t}_{k}'] if o == t) / SHOTS for t in range(16)) / 16
    print(f'k={k}  real P(target) mean {p:.3f}')
print('saved', fn)
