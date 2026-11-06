# Rejected chip runs (kept for the record, never shown as a result)

- `wheel-2026-11-04-ibm_fez-dbma7apkbkrc73cp4vo0.json` (5 Nov 15:41 UTC): the twin test in the same job scored 17.5 %
  (175 of 1,000; pairs 1-3 came out anti-correlated, pair 4 correlated: the opposite of the 14:23 UTC job on the SAME
  qubits 124/123 with the same gates, which scored 83.2 %). The identical transpiled circuits give 85 % on a perfect
  simulator, so the chip itself misbehaved: ibm_fez recalibrated at 15:14 UTC, and a phase error inside the CZ gate
  turns into a bit flip, which is exactly this pattern. The wheel in the same job was far from the prediction (total
  variation 0.41; the noise model predicted about 0.08). The twin test is the health check: under 79 %, the run is
  rejected and redone.
