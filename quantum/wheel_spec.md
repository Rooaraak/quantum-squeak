# The Quantum Wheel: recipe v1.2 (2026-11-05)

Squeektoshi's real night programs a quantum walk on a ring of 16 spots (one hamster per spot).

- **Input**: his Squeek day (12:00 to 12:00 UTC), turns per 10-minute round, read from SqueekCore `roundPage`
  (cumulative work per active round). Only active rounds (turns > 0) count, in order.
- **Steps**: one step per active round. More than 16 active rounds: split them into 16 consecutive groups as evenly
  as possible (earlier groups take the extra round); a group's turns = its mean, rounded half up.
- **Coin angle**: theta = pi * min(turns, 700) / 700. 0 turns: the coin is untouched (the quantum hamster coasts);
  350 turns: a 50/50 mix; 700+ turns: the coin flips (a sprint turns him round).
- **Start**: spot 0, coin (|0> + i|1>)/sqrt(2).
- **One step**: coin RY(theta), then shift: coin 1 moves +1 (clockwise), coin 0 moves -1 (mod 16).
- **Circuit**: qubit 0 = coin, qubits 1-4 = position bits 0-3. The shift is applied in the Fourier basis (start = H on
  the position qubits, per step P(-phi_j) on bit j and CP(2 phi_j) from the coin, phi_j = 2 pi 2^j / 16, bit 3 needs
  only Z), then one inverse QFT; the measured 4 bits are the spot.
- **Normal hamster** (for comparison): the same coin, but looked at after every step (a plain random walk:
  keep direction cos^2(theta/2), turn round sin^2(theta/2)).
- **Catch** (Quantum Catch, the owner's rules of 5 Nov; contracts/src/QuantumCatch.sol, `wheel.py` `in_reach` and
  `tiers_of`): the chip runs the wheel 4,000 times. **Reach**: his start is spot (his total turns) mod 16 (the v1.1 ring
  turn below) and every step moves the walk one spot, so a spot is in reach that night only if it has the right parity
  ((spot + total turns + steps) even) AND lies at most `steps` spots from his start around the ring. Landings out of
  reach are the chip's noise: a net there never catches, whatever its share. **Catchable**: in reach and at least 1 % of
  the shots. **Rarity by rank**: rank the catchable spots by landings, most first (equal landings: the lower spot
  first); with n of them, rank r: Epic r = n, Rare r = n - 1, Uncommon r = n - 3 or n - 2, Common r <= n - 4.
  **Legendary**: the Epic spot when the chip's very first shot of the night landed on it (the result file's
  `shots_in_order[0]`, a position, turned onto the ring like the counts: spot = (position + total turns) mod 16). Every
  other spot: he got away. With 8 catchable spots: 4 Common, 2 Uncommon, 1 Rare, 1 Epic (Legendary on about 1 net in
  250). Tier codes 0 got away, 1 Common .. 5 Legendary; checked against `contracts/test/data/tier-vectors.json`. The
  spot's 4 bits pick the hamster (bit 0 party hat, bit 1 glasses, bit 2 scarf, bit 3 grin), as on the v9 wish board.
- **Proof**: the same IBM job carries the twin test (CHSH, 4 card pairs x 250 shots, as in dawn_run.py). Any fixed
  plan wins at most 75 %; a perfect chip about 85.4 %. A demonstration on one chip, not a lab-grade test.
- **v1.1 ring turn (5 Nov)**: with the 16-step cap nearly every night has an even number of steps, so the walk only
  reaches spots of one parity: the same half of the ring would be dark every night (parity, not interference: the
  normal hamster can't reach those spots either). So the ring is turned by his night: spot = (position + his total
  turns) mod 16. The walk is the same on every turn of the ring, so this is exactly the chip's result read from his own
  starting spot; no new circuit. Which half is dark now changes with his run and can't be known before he runs.
  Page wording: call the parity half "out of reach tonight", never "the ghosts cancelled"; interference language only
  for reachable spots that the quantum hamster visits far less (or far more) than the normal one.
- **v1.2 at most 10 steps + DD/twirling (5 Nov)**: the archive (29 Oct - 4 Nov, run as v1.1 with up to 16 steps) showed
  depth-driven decoherence: on 4 of the 6 sixteen-step nights the chip's landings were closer to the NORMAL hamster than
  to the perfect quantum walk (total variation, e.g. 1 Nov 0.322 vs 0.180), while the 14-step night stayed clearly
  quantum (0.128 vs 0.345). IBM's noise model puts the best margin at 10 steps (about 71 two-qubit gates). From v1.2:
  more than 10 active rounds are grouped into 10 steps, and every run uses dynamical decoupling (XpXm) and gate
  twirling. Archive nights keep their own recipe and steps (stored in each result file). The page states per night
  whether the chip kept the quantum pattern or noise washed most of it out, from the two distances.
