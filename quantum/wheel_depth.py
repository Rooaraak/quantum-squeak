"""Transpile the 11-04 wheel for ibm_fez (no job, no chip time) and report the 2-qubit gate count and depth."""
import sys, warnings; warnings.filterwarnings('ignore')
from qiskit import transpile
from qiskit_ibm_runtime import QiskitRuntimeService
import wheel
NIGHTS = {'2026-11-04': [250, 471, 500, 178, 452, 136, 485, 48, 308, 316, 338, 150, 179]}
be = QiskitRuntimeService(name='ibm-new-2026-11-06', instance='open-instance').backend('ibm_fez')
for steps in (NIGHTS['2026-11-04'], [400] * 16):
    best = None
    for seed in range(8):
        t = transpile(wheel.build_circuit(steps), backend=be, optimization_level=3, seed_transpiler=seed)
        n2 = sum(1 for i in t.data if i.operation.num_qubits == 2)
        if best is None or n2 < best[0]: best = (n2, t.depth(), seed, sorted(t.layout.initial_index_layout()[:5]) if t.layout else None)
    print(f'{len(steps)} steps: best 2q gates {best[0]}, depth {best[1]}, seed {best[2]}')
