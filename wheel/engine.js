/* Quantum Catch wheel engine (quantum/wheel_spec.md; a JS copy of quantum/wheel.py, checked against data/wheel-vectors.json
   to 1e-9). Plain JS, no dependencies: in a browser it sets window.QW, in node module.exports.
   Recipe per night: v1.1 (the 29 Oct - 4 Nov archive) groups his active rounds into at most 16 steps, v1.2 (from 5 Nov)
   into at most 10 (capOf). walk() works in POSITIONS (steps from his start, as the chip measures them); v1.1 turns the
   ring by his night: spot = (position + total turns) mod 16 (ringTurn / spotOf / turned).
   Reach and rarity are the game's rules (contracts/src/QuantumCatch.sol; checked against wheel/test/tier_ref.py):
   reachable/inReach (parity AND ring distance, cf509b4) and tiers (the owner's rank rule, 5 Nov). */
(function (root, make) {
  if (typeof module === 'object' && module.exports) module.exports = make();
  else root.QW = make();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var N = 16, CAP = 10, MAX_TURNS = 700;
  // the step cap of each recipe: v1.1 (archive, result files say 'wheel_spec.md v1') 16, v1.2 10 (wheel.py CAP)
  var CAPS = { 'v1': 16, 'v1.1': 16, 'v1.2': 10 };
  function capOf(recipe) {
    var m = /(?:^|\s)(v1(?:\.\d+)?)$/.exec(String(recipe || '').trim());
    if (!m || !CAPS[m[1]]) throw new Error('unknown recipe: ' + recipe);
    return CAPS[m[1]];
  }
  // tier names by index (the contract's tier code - 1): -1 = got away
  var TIER_NAMES = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];

  // which active rounds (turns > 0) make each step: indices into w. More than `cap` active rounds (default 10, recipe
  // v1.2; 16 for v1.1): `cap` consecutive groups, as even as possible, earlier groups take the extra round.
  function groups(w, cap) {
    var C = cap == null ? CAP : cap, act = [];
    for (var i = 0; i < w.length; i++) if (w[i] > 0) act.push(i);
    if (act.length <= C) return act.map(function (i) { return [i]; });
    var q = Math.floor(act.length / C), r = act.length % C, out = [], k = 0;
    for (var g = 0; g < C; g++) {
      var n = q + (g < r ? 1 : 0);
      out.push(act.slice(k, k + n)); k += n;
    }
    return out;
  }

  // one step per group: the group's mean turns, rounded half up (as Python's floor(x + 0.5))
  function steps(w, cap) {
    return groups(w, cap).map(function (g) {
      var s = 0;
      for (var i = 0; i < g.length; i++) s += w[g[i]];
      return g.length === 1 ? w[g[0]] : Math.floor(s / g.length + 0.5);
    });
  }

  function angle(turns) { return Math.PI * Math.min(turns, MAX_TURNS) / MAX_TURNS; }

  var zeros = function () { var a = new Array(N); for (var i = 0; i < N; i++) a[i] = 0; return a; };
  var left = function (a) { var b = new Array(N); for (var i = 0; i < N; i++) b[i] = a[(i + 1) % N]; return b; };       // spot s -> s-1
  var right = function (a) { var b = new Array(N); for (var i = 0; i < N; i++) b[i] = a[(i + N - 1) % N]; return b; };  // spot s -> s+1

  // perfect quantum walk and the normal (looked-at) hamster with the same coins. The coin RY(theta) and the shift are
  // real maps, so the real and imaginary parts of the state evolve separately: start (|0> + i|1>)/sqrt2 at spot 0.
  function walk(st) {
    var h = Math.SQRT1_2;
    var re0 = zeros(), re1 = zeros(), im0 = zeros(), im1 = zeros();
    re0[0] = h; im1[0] = h;
    var pr0 = zeros(), pr1 = zeros(); pr0[0] = 0.5; pr1[0] = 0.5;
    var perfectTrace = [], normalTrace = [];
    var probs = function () { var p = zeros(); for (var s = 0; s < N; s++) p[s] = re0[s] * re0[s] + re1[s] * re1[s] + im0[s] * im0[s] + im1[s] * im1[s]; return p; };
    for (var k = 0; k < st.length; k++) {
      var th = angle(st[k]), c = Math.cos(th / 2), sn = Math.sin(th / 2);
      var a0, a1, b0, b1;
      a0 = zeros(); a1 = zeros(); b0 = zeros(); b1 = zeros();
      for (var s = 0; s < N; s++) {
        a0[s] = c * re0[s] - sn * re1[s]; a1[s] = sn * re0[s] + c * re1[s];
        b0[s] = c * im0[s] - sn * im1[s]; b1[s] = sn * im0[s] + c * im1[s];
      }
      re0 = left(a0); re1 = right(a1); im0 = left(b0); im1 = right(b1);
      perfectTrace.push(probs());
      var keep = c * c, flip = sn * sn, n0 = zeros(), n1 = zeros();
      for (s = 0; s < N; s++) { n0[s] = keep * pr0[s] + flip * pr1[s]; n1[s] = flip * pr0[s] + keep * pr1[s]; }
      pr0 = left(n0); pr1 = right(n1);
      var np = zeros(); for (s = 0; s < N; s++) np[s] = pr0[s] + pr1[s];
      normalTrace.push(np);
    }
    var normal = zeros(); for (var t = 0; t < N; t++) normal[t] = pr0[t] + pr1[t];
    return { perfect: probs(), normal: normal, perfectTrace: perfectTrace, normalTrace: normalTrace };
  }

  function tierIndex(name) { return name == null ? -1 : TIER_NAMES.indexOf(name); }

  // v1.1: with an even number of steps the walk only reaches positions of one parity, so the ring is turned by his night
  function ringTurn(turnsPerRound) { var s = 0; for (var i = 0; i < turnsPerRound.length; i++) s += turnsPerRound[i]; return s % N; }
  function spotOf(position, turn) { return (position + turn) % N; }
  function turned(p, turn) { var out = zeros(); for (var pos = 0; pos < N; pos++) out[spotOf(pos, turn)] = p[pos]; return out; }
  // reach (the contract's rule, cf509b4): after k steps of +1 or -1 the walk is on a position with the parity of k that is at
  // most k spots from his start, around the ring. The rest is out of reach that night: it never catches, and any landings
  // there are the chip's noise. (Interference words are only for spots the walk does reach.)
  function ringDistance(a, b) { var d = Math.abs(a - b) % N; return Math.min(d, N - d); }
  function reachable(position, k) { var p = ((position % N) + N) % N; return ((p - k) % 2 + 2) % 2 === 0 && Math.min(p, N - p) <= k; }
  // the same for a SPOT on the turned ring: his start is spot turns % 16, so position = spot - turns (mod 16)
  function inReach(spot, turns, steps) { return reachable(((spot - turns) % N + N) % N, steps); }

  // the owner's rarity rule (5 Nov), one night at a time: counts = landings per SPOT, turns = his total turns, steps,
  // first = the spot of the chip's very first shot (shots_in_order[0], turned). A spot is catchable if it is in reach and
  // has at least 1 % of the shots (integer compare, as the contract: hits * 100 >= shots). Rank the catchable spots by
  // landings, most first, equal landings the lower spot first: the last is Epic (Legendary if the first shot landed
  // there), the one before it Rare, the two before that Uncommon, the rest Common. Returns 16 tier indices into
  // TIER_NAMES, -1 = got away (under 1 %, or out of reach).
  function tiers(counts, turns, steps, first) {
    var shots = 0, out = [], order = [];
    for (var s = 0; s < N; s++) { shots += counts[s]; out.push(-1); }
    if (!(shots > 0)) return out;
    for (s = 0; s < N; s++) if (inReach(s, turns, steps) && counts[s] * 100 >= shots) order.push(s);
    order.sort(function (a, b) { return counts[b] - counts[a] || a - b; });
    var n = order.length;
    order.forEach(function (sp, i) {
      var rarer = n - 1 - i;                                          // catchable spots below this one in the ranking
      out[sp] = rarer === 0 ? (sp === first ? 4 : 3) : rarer === 1 ? 2 : rarer <= 3 ? 1 : 0;
    });
    return out;
  }

  // a share as the page prints it: one decimal, rounded DOWN, so the number never shows the 1 % line before it is reached
  // (39 of 4,000 prints 0.9 %, got away; 40 prints 1.0 %)
  function pctText(share) {
    var v = share * 100;
    if (!(v > 0)) return '0%';
    if (v < 0.1) return '<0.1%';
    return (Math.floor(v * 10 + 1e-9) / 10).toFixed(1) + '%';
  }

  function looks(spot) { return { hat: spot & 1, glasses: (spot >> 1) & 1, neckwear: (spot >> 2) & 1, face: (spot >> 3) & 1 }; }

  // total variation distance: half the L1 distance (0 = the same, 1 = nothing in common)
  function tvd(a, b) {
    if (a.length !== b.length) throw new Error('tvd: length ' + a.length + ' vs ' + b.length);
    var s = 0;
    for (var i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
    return s / 2;
  }
  // decision 5: did the chip keep the quantum pattern this night? Both distances in position space (unturned):
  // dq = chip vs the perfect quantum walk, dn = chip vs the normal hamster; kept only when dq < dn (a tie is noise).
  // closer = dn / dq: how many times closer the chip's landings are to the quantum ghost than to a normal hamster.
  function quantumness(counts, shots, perfect, normal) {
    if (!(shots > 0)) throw new Error('quantumness: no shots');
    var chip = counts.map(function (c) { return c / shots; });
    var dq = tvd(chip, perfect), dn = tvd(chip, normal);
    return { dq: dq, dn: dn, kept: dq < dn, closer: dq > 0 ? dn / dq : Infinity };
  }

  return { N: N, CAP: CAP, CAPS: CAPS, MAX_TURNS: MAX_TURNS, TIER_NAMES: TIER_NAMES, groups: groups, steps: steps, capOf: capOf, angle: angle,
    walk: walk, tierIndex: tierIndex, tiers: tiers, pctText: pctText, looks: looks, ringTurn: ringTurn, spotOf: spotOf, turned: turned,
    ringDistance: ringDistance, reachable: reachable, inReach: inReach, tvd: tvd, quantumness: quantumness };
});
