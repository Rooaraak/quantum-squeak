// The page's engine must reproduce the frozen recipe (quantum/wheel_spec.md, quantum/wheel.py) on every real night in
// data/wheel-vectors.json to 1e-9 (those nights are recipe v1.1: up to 16 steps), recipe v1.2 (at most 10 steps), the
// reach (contracts cf509b4: parity AND ring distance), the owner's rarity rule (5 Nov: rank among the night's catchable
// spots, Legendary = the Epic spot hit by the chip's first shot) against the Python reference wheel/test/tier_ref.py on
// every spot of all 9 real chip runs and on synthetic nights, and the per-night quantumness verdict.   node --test wheel/test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = new URL('.', import.meta.url).pathname;
const QW = require(here + '../engine.js');
const V = JSON.parse(fs.readFileSync(here + '../../data/wheel-vectors.json', 'utf8'));
const REF = JSON.parse(execFileSync('python3', [here + 'tier_ref.py'], { encoding: 'utf8', maxBuffer: 64 << 20 }));   // the Python reference
const TOL = 1e-9;
const close = (a, b, what) => {
  assert.equal(a.length, b.length, `${what}: length ${a.length} vs ${b.length}`);
  a.forEach((x, i) => assert.ok(Math.abs(x - b[i]) <= TOL, `${what}[${i}]: ${x} vs ${b[i]} (diff ${Math.abs(x - b[i])})`));
};

test('exports the engine API', () => {
  for (const f of ['steps', 'groups', 'capOf', 'angle', 'walk', 'tiers', 'pctText', 'looks', 'ringTurn', 'spotOf', 'turned', 'ringDistance', 'reachable', 'inReach', 'tvd', 'quantumness']) assert.equal(typeof QW[f], 'function', f);
  assert.equal(QW.hatch, undefined, 'no "hatch" left in the engine (the game is Quantum Catch)');
  for (const gone of ['rarity', 'landing', 'TIERS']) assert.equal(QW[gone], undefined, `${gone}: the share tiers are gone (rarity is a rank among the night's catchable spots)`);
  assert.deepEqual(QW.TIER_NAMES, ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
});

test('steps (v1.1 cap 16): active rounds only, in order; more than 16 are grouped (earlier groups take the extra, mean half up)', () => {
  assert.deepEqual(QW.steps([0, 5, 0, 7, 0], 16), [5, 7]);
  assert.deepEqual(QW.steps([], 16), []);
  const s = QW.steps(Array.from({ length: 20 }, (_, i) => i + 1), 16);      // same case as quantum/tests/test_wheel.py
  assert.equal(s.length, 16);
  assert.deepEqual(s.slice(0, 5), [2, 4, 6, 8, 9]);
  assert.deepEqual(QW.steps([1, 2, ...Array(15).fill(10)], 16).slice(0, 2), [2, 10]);   // mean 1.5 rounds half UP to 2
});

// recipe v1.2 (5 Nov): at most 10 steps. Expected values printed by quantum/wheel.py steps_from_w(w, 10).
test('steps (v1.2 cap 10, the default, as wheel.py): more than 10 active rounds are grouped into 10 steps', () => {
  const w20 = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.deepEqual(QW.steps(w20, 10), [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  assert.deepEqual(QW.steps(w20), QW.steps(w20, 10), 'default cap = 10, like wheel.py CAP');
  assert.deepEqual(QW.steps([0, 5, 0, 7, ...Array(12).fill(300), 1, 2], 10), [6, 300, 300, 300, 300, 300, 300, 300, 1, 2]);
  const nov4 = [6, 250, 471, 500, 178, 452, 136, 485, 48, 308, 316, 338, 150, 179];     // his real 4 Nov night (14 rounds)
  assert.deepEqual(QW.steps(nov4, 10), [128, 486, 315, 311, 48, 308, 316, 338, 150, 179]);
  assert.deepEqual(QW.steps(nov4, 16), nov4, 'v1.1 keeps all 14 (as the 4 Nov chip run did)');
  assert.deepEqual(QW.steps([5, 0, 7], 10), [5, 7]);
  const p = QW.walk(QW.steps(nov4, 10)).perfect, n = QW.walk(QW.steps(nov4, 10)).normal;      // wheel.py ideal_walk / normal_walk
  [0.043683963431, 0, 0.033145536605, 0, 0.181596581788, 0, 0.136332368921, 0, 0.25416706194, 0, 0.136332368921, 0, 0.181596581788, 0, 0.033145536605, 0]
    .forEach((x, i) => assert.ok(Math.abs(p[i] - x) < 1e-9, `v1.2 perfect[${i}]`));
  [0.187410363724, 0, 0.160659547878, 0, 0.11566319894, 0, 0.089165703077, 0, 0.081612736487, 0, 0.089165703077, 0, 0.11566319894, 0, 0.160659547878, 0]
    .forEach((x, i) => assert.ok(Math.abs(n[i] - x) < 1e-9, `v1.2 normal[${i}]`));
});

test('capOf: the recipe string of a night picks its cap (archive files say "wheel_spec.md v1" = v1.1 = 16)', () => {
  assert.equal(QW.capOf('wheel_spec.md v1.2'), 10);
  assert.equal(QW.capOf('v1.2'), 10);
  assert.equal(QW.capOf('wheel_spec.md v1.1'), 16);
  assert.equal(QW.capOf('wheel_spec.md v1'), 16);
  assert.equal(QW.capOf(V.recipe), 16, 'the vectors file is v1.1');
  assert.throws(() => QW.capOf('wheel_spec.md v2'), /recipe/);
});

test('groups: which active rounds make each step (both caps)', () => {
  assert.deepEqual(QW.groups([0, 5, 0, 7], 16), [[1], [3]]);                 // indices into the input list
  const g = QW.groups(Array.from({ length: 20 }, (_, i) => i + 1), 16);
  assert.equal(g.length, 16);
  assert.deepEqual(g.slice(0, 5), [[0, 1], [2, 3], [4, 5], [6, 7], [8]]);
  assert.deepEqual(g.flat(), Array.from({ length: 20 }, (_, i) => i));
  const g10 = QW.groups(Array.from({ length: 20 }, (_, i) => i + 1), 10);
  assert.equal(g10.length, 10); assert.deepEqual(g10[9], [18, 19]);
  assert.deepEqual(QW.groups(Array.from({ length: 20 }, (_, i) => i + 1)), g10, 'default cap 10');
});

test('angle: pi * min(turns, 700) / 700', () => {
  assert.equal(QW.angle(0), 0);
  assert.ok(Math.abs(QW.angle(350) - Math.PI / 2) < 1e-15);
  assert.ok(Math.abs(QW.angle(700) - Math.PI) < 1e-15);              // pi * 700 / 700 in floats, as in wheel.py
  assert.equal(QW.angle(900), QW.angle(700));
});

test('every real night: steps, angles, perfect, normal and both traces match the Python reference to 1e-9', () => {
  const nights = Object.entries(V.nights);
  assert.equal(nights.length, 7);
  for (const [day, n] of nights) {
    const w = n.rounds.map((r) => r[1]);
    const st = QW.steps(w, QW.capOf(V.recipe));
    assert.deepEqual(st, n.steps, `${day} steps`);
    close(st.map(QW.angle), n.angles, `${day} angles`);
    const r = QW.walk(st);
    close(r.perfect, n.perfect, `${day} perfect`);
    close(r.normal, n.normal, `${day} normal`);
    assert.equal(r.perfectTrace.length, n.perfectTrace.length, `${day} perfectTrace steps`);
    assert.equal(r.normalTrace.length, n.normalTrace.length, `${day} normalTrace steps`);
    r.perfectTrace.forEach((row, k) => close(row, n.perfectTrace[k], `${day} perfectTrace[${k}]`));
    r.normalTrace.forEach((row, k) => close(row, n.normalTrace[k], `${day} normalTrace[${k}]`));
  }
});

test('walks: probabilities sum to 1; even step counts leave every odd position exactly 0', () => {
  for (const [day, n] of Object.entries(V.nights)) {
    const r = QW.walk(n.steps);
    for (const p of [r.perfect, r.normal]) assert.ok(Math.abs(p.reduce((a, b) => a + b, 0) - 1) < 1e-12, day);
    if (n.steps.length % 2 === 0) for (let s = 1; s < 16; s += 2) { assert.ok(r.perfect[s] < 1e-15, `${day} perfect odd ${s}`); assert.ok(r.normal[s] < 1e-15, `${day} normal odd ${s}`); }
  }
});

test('walk: a coasting hamster (no turns) splits into two copies that move away ballistically', () => {
  const r = QW.walk([0, 0, 0]);
  assert.ok(Math.abs(r.perfect[3] - 0.5) < 1e-12 && Math.abs(r.perfect[13] - 0.5) < 1e-12);
  const e = QW.walk([]);
  assert.ok(Math.abs(e.perfect[0] - 1) < 1e-12); assert.equal(e.normal[0], 1); assert.deepEqual(e.perfectTrace, []);
});

// the owner's rarity rule (5 Nov). QW.tiers(counts per SPOT, his total turns, steps, the first shot's spot) gives one
// night's tier index per spot: -1 got away, 0 Common, 1 Uncommon, 2 Rare, 3 Epic, 4 Legendary (= contract code - 1)
const asIndex = (codes) => codes.map((c) => c - 1);
test('tiers: the Python reference on every spot of all 9 real chip runs (7 archive nights + 2 v1.2 re-runs)', () => {
  assert.equal(REF.real.length, 9);
  const root = here + '../../quantum/';
  for (const x of REF.real) {
    const R = JSON.parse(fs.readFileSync(root + x.file, 'utf8')), T = QW.ringTurn(R.rounds.map((r) => r[1]));
    assert.deepEqual(QW.turned(R.counts, T), x.counts, `${x.file}: landings per spot`);
    assert.equal(QW.spotOf(R.shots_in_order[0], T), x.first, `${x.file}: the first shot, turned onto the ring`);
    const t = QW.tiers(x.counts, x.turns, x.steps, x.first);
    assert.deepEqual(t, asIndex(x.tiers), `${x.file}: tier of every spot`);
    assert.equal(t.filter((v) => v >= 0).length, 8, `${x.file}: 8 catchable spots`);
    assert.deepEqual([0, 1, 2, 3, 4].map((k) => t.filter((v) => v === k).length), [4, 2, 1, 1, 0], `${x.file}: 4 Common, 2 Uncommon, 1 Rare, 1 Epic, no Legendary`);
  }
  // the newest archive night (4 Nov): ranked by landings 15 3 1 9 | 7 5 | 13 | 11; spot 11 (289 of 4,000) is Epic
  const n4 = REF.real.find((x) => x.night === '2026-11-04' && x.steps === 14), t4 = QW.tiers(n4.counts, n4.turns, n4.steps, n4.first);
  assert.deepEqual([15, 3, 1, 9, 7, 5, 13, 11].map((s) => t4[s]), [0, 0, 0, 0, 1, 1, 2, 3]);
  assert.equal(n4.first, 15, 'its first shot landed on spot 15 (Common)');
  assert.equal(QW.tiers(n4.counts, n4.turns, n4.steps, 11)[11], 4, 'had the first shot landed on 11: Legendary');
});

test('tiers: the Python reference on synthetic nights (Legendary, n = 0..8, ties, the 1 % line, short nights)', () => {
  assert.ok(REF.synth.length > 400);
  let legend = 0;
  for (const [i, x] of REF.synth.entries()) {
    const t = QW.tiers(x.counts, x.turns, x.steps, x.first);
    assert.deepEqual(t, asIndex(x.tiers), `synthetic ${i} (${x.why}): ${JSON.stringify(x)}`);
    legend += t.includes(4);
  }
  assert.ok(legend >= 30, `${legend} nights with a Legendary`);
});

test('tiers: the rule by hand (n, ties at the bottom, the integer 1 % line, Legendary only on the Epic spot)', () => {
  const z = () => Array(16).fill(0);
  // start 0 (16 turns), 2 steps: spots 14, 0, 2 in reach
  assert.equal(QW.tiers([4000, ...Array(15).fill(0)], 16, 2, 0)[0], 4, 'n = 1: the only catch is Epic, Legendary on the first shot');
  assert.equal(QW.tiers([4000, ...Array(15).fill(0)], 16, 2, 1)[0], 3, 'n = 1, the first shot elsewhere: Epic');
  const two = z(); two[0] = 3000; two[2] = 1000;
  assert.deepEqual([QW.tiers(two, 16, 2, 0)[0], QW.tiers(two, 16, 2, 0)[2]], [2, 3], 'n = 2: Rare, Epic; the first shot on the Rare spot changes nothing');
  assert.equal(QW.tiers(two, 16, 2, 2)[2], 4, 'the first shot on the Epic spot: Legendary');
  const tie = z(); tie[0] = 40; tie[2] = 40; tie[14] = 3920;
  assert.deepEqual([14, 0, 2].map((s) => QW.tiers(tie, 16, 2, 14)[s]), [1, 2, 3], 'equal landings: the lower spot ranks first, so spot 2 is Epic');
  const edge = z(); edge[0] = 39; edge[2] = 39; edge[14] = 3922;
  assert.deepEqual([14, 0, 2].map((s) => QW.tiers(edge, 16, 2, 14)[s]), [4, -1, -1], '39 of 4,000 is under 1 %: got away');
  const e4001 = z(); e4001[0] = 40; e4001[2] = 41; e4001[14] = 3920;
  assert.deepEqual([0, 2].map((s) => QW.tiers(e4001, 16, 2, 14)[s]), [-1, 3], '40 of 4,001 is under 1 % (integer compare), 41 is not');
  const loud = z(); loud[1] = 4000; loud[0] = 100;
  assert.deepEqual(QW.tiers(loud, 16, 2, 1), [3, ...Array(15).fill(-1)], 'an out-of-reach spot never catches and never ranks');
  const all = Array(16).fill(250);
  assert.deepEqual(QW.tiers(all, 3817, 10, 7).filter((v, s) => s % 2), [0, 0, 0, 0, 1, 1, 2, 3], 'all equal: ranked by spot number');
  assert.deepEqual(QW.tiers(z(), 16, 2, 0), Array(16).fill(-1), 'no landings: nothing to catch');
});

test('looks: the spot\'s 4 bits pick hat, glasses, neckwear, face', () => {
  assert.deepEqual(QW.looks(0), { hat: 0, glasses: 0, neckwear: 0, face: 0 });
  assert.deepEqual(QW.looks(1), { hat: 1, glasses: 0, neckwear: 0, face: 0 });
  assert.deepEqual(QW.looks(6), { hat: 0, glasses: 1, neckwear: 1, face: 0 });
  assert.deepEqual(QW.looks(15), { hat: 1, glasses: 1, neckwear: 1, face: 1 });
  assert.deepEqual(QW.looks(8), { hat: 0, glasses: 0, neckwear: 0, face: 1 });
});

test('v1.1 ring turn: the ring is turned by his total turns (spot = (position + turn) mod 16), same as wheel.py', () => {
  assert.equal(QW.ringTurn([6, 250, 471, 500, 178, 452, 136, 485, 48, 308, 316, 338, 150, 179]), 3817 % 16);   // = 9
  assert.equal(QW.ringTurn(V.nights['2026-11-04'].rounds.map((r) => r[1])), 9);
  assert.equal(QW.ringTurn([]), 0);
  assert.equal(QW.spotOf(15, 3), 2);
  assert.equal(QW.spotOf(0, 9), 9);
  const p = QW.walk([300, 120, 650]).perfect, q = QW.turned(p, 5);
  for (let pos = 0; pos < 16; pos++) assert.equal(q[QW.spotOf(pos, 5)], p[pos]);
  assert.deepEqual(QW.turned(p, 0), p);
});

test('reach (contracts cf509b4): the parity of k AND at most k spots from his start; on the 9 real runs = where the walk can land', () => {
  assert.equal(QW.ringDistance(0, 15), 1); assert.equal(QW.ringDistance(3, 11), 8); assert.equal(QW.ringDistance(9, 9), 0); assert.equal(QW.ringDistance(14, 2), 4);
  for (const [day, n] of Object.entries(V.nights)) {
    const k = n.steps.length;
    for (let pos = 0; pos < 16; pos++) {
      assert.equal(QW.reachable(pos, k), pos % 2 === k % 2 && Math.min(pos, 16 - pos) <= k, `${day} pos ${pos}`);
      if (!QW.reachable(pos, k)) assert.ok(n.perfect[pos] === 0 && n.normal[pos] === 0, `${day} pos ${pos} must be exactly 0`);
    }
  }
  // short nights: after 1 step only his start's 2 neighbours, after 3 steps the right parity within 3
  assert.deepEqual([...Array(16).keys()].filter((p) => QW.reachable(p, 1)), [1, 15]);
  assert.deepEqual([...Array(16).keys()].filter((p) => QW.reachable(p, 3)), [1, 3, 13, 15]);
  assert.deepEqual([...Array(16).keys()].filter((p) => QW.reachable(p, 0)), [0]);
  assert.equal([...Array(16).keys()].filter((p) => QW.reachable(p, 7)).length, 8, 'from 7 steps on the distance excludes nothing');
  assert.equal(QW.reachable(3, 3), true); assert.equal(QW.reachable(2, 3), false); assert.equal(QW.reachable(5, 3), false);
  // inReach(spot, turns, steps) = reachable(spot - his start): every spot of every real run and synthetic night (Python)
  for (const x of [...REF.real, ...REF.synth]) for (let s = 0; s < 16; s++) {
    assert.equal(QW.inReach(s, x.turns, x.steps), x.reach[s], `${x.file || x.why} spot ${s}`);
    assert.equal(QW.inReach(s, x.turns, x.steps), QW.reachable(((s - x.turns) % 16 + 16) % 16, x.steps));
  }
  // on the real runs the rule is exactly where the perfect walk can land (P > 1e-12): Python's walk and the engine's
  for (const x of REF.real) {
    assert.deepEqual(x.reach, x.perfectReach, `${x.file}: reach = the perfect walk's support (Python)`);
    const R = JSON.parse(fs.readFileSync(here + '../../quantum/' + x.file, 'utf8')), P = QW.turned(QW.walk(R.steps).perfect, x.ringTurn);
    assert.deepEqual(P.map((p) => p > 1e-12), x.reach, `${x.file}: reach = the engine walk's support`);
  }
  // short random walks (k = 1..6, 1..699 turns per step): the walk never lands outside the rule
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 300; i++) {
    const k = 1 + Math.floor(rnd() * 6), st = Array.from({ length: k }, () => 1 + Math.floor(rnd() * 699)), P = QW.walk(st).perfect;
    for (let p = 0; p < 16; p++) if (P[p] > 1e-12) assert.ok(QW.reachable(p, k), `${st} position ${p}: P = ${P[p]} outside the rule`);
  }
});

// review fix: the page prints shares rounded DOWN to 1 decimal, so a printed share never shows "1.0%" for a spot under the
// 1 % line (the only share line left: rarity is a rank). 39 of 4,000 prints 0.9 %, 40 prints 1.0 %.
test('pctText: one decimal rounded down; "1.0%" or more only at the 1 % line or above (every count of 4,000, 4,001 and 333)', () => {
  assert.equal(QW.pctText(0.014897), '1.4%');
  assert.equal(QW.pctText(0.024777), '2.4%');
  assert.equal(QW.pctText(39 / 4000), '0.9%');
  assert.equal(QW.pctText(40 / 4000), '1.0%');
  assert.equal(QW.pctText(100 / 4000), '2.5%');
  assert.equal(QW.pctText(399 / 4000), '9.9%');
  assert.equal(QW.pctText(1), '100.0%');
  assert.equal(QW.pctText(0), '0%');
  assert.equal(QW.pctText(0.0004), '<0.1%');
  for (const shots of [4000, 4001, 333]) for (let hits = 0; hits <= shots; hits++) {
    const t = QW.pctText(hits / shots), v = t === '0%' || t === '<0.1%' ? 0 : Number(t.slice(0, -1));
    assert.equal(v >= 1, hits * 100 >= shots, `${hits}/${shots} printed ${t}`);
  }
});

// decision 5 (5 Nov): honest quantumness per night. d_q = TVD(chip, perfect walk), d_n = TVD(chip, normal hamster), both in
// position space (unturned). The 7 archive nights (v1.1, up to 16 steps): noise won on 4 of them (30 Oct - 2 Nov).
test('tvd: half the L1 distance of two distributions', () => {
  assert.equal(QW.tvd([1, 0], [0, 1]), 1);
  assert.equal(QW.tvd([0.5, 0.5], [0.5, 0.5]), 0);
  assert.ok(Math.abs(QW.tvd([0.7, 0.3, 0], [0.2, 0.3, 0.5]) - 0.5) < 1e-15);
  assert.throws(() => QW.tvd([1], [0.5, 0.5]), /length/);
});

test('quantumness: the 7 archive chip nights (v1.1) give exactly the archive verdicts (4 of 7 noise), closer-by = d_n / d_q', () => {
  const root = here + '../../quantum/';
  const runs = fs.readdirSync(root).filter((f) => /^wheel-2026-.*-ibm_marrakesh-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(root + f, 'utf8')));
  const files = runs.filter((R) => QW.capOf(R.recipe) === 16);
  assert.equal(files.length, 7);
  const want = { '2026-10-29': true, '2026-10-30': false, '2026-10-31': false, '2026-11-01': false, '2026-11-02': false, '2026-11-03': true, '2026-11-04': true };
  const got = {};
  for (const R of files) {
    const w = QW.walk(R.steps), q = QW.quantumness(R.counts, R.wheel_shots, w.perfect, w.normal);
    const chip = R.counts.map((c) => c / R.wheel_shots);
    assert.ok(Math.abs(q.dq - QW.tvd(chip, R.perfect)) < 1e-9 && Math.abs(q.dn - QW.tvd(chip, R.normal)) < 1e-9, `${R.night}: same distances as the file's own perfect/normal`);
    assert.equal(q.kept, q.dq < q.dn);
    assert.ok(Math.abs(q.closer - q.dn / q.dq) < 1e-12);
    got[R.night] = q.kept;
    if (R.night === '2026-11-04') { assert.ok(Math.abs(q.dq - 0.128) < 0.001 && Math.abs(q.dn - 0.345) < 0.001, `${q.dq} ${q.dn}`); assert.equal(q.closer.toFixed(1), '2.7'); }
    if (R.night === '2026-11-01') assert.ok(Math.abs(q.dq - 0.322) < 0.001 && Math.abs(q.dn - 0.180) < 0.001);
  }
  assert.deepEqual(got, want);
  assert.equal(Object.values(got).filter((k) => !k).length, 4, 'noise won on 4 of the 7 archive nights');
  // the v1.2 validation re-runs of two archive nights (10 steps + noise protection, 5 Nov): both kept the pattern,
  // incl. 1 Nov where the 16-step run lost to noise (0.193 vs 0.360)
  const v12 = runs.filter((R) => QW.capOf(R.recipe) === 10);
  for (const R of v12) {
    assert.ok(R.steps.length <= 10, `${R.night} v1.2 has at most 10 steps`);
    assert.deepEqual(QW.steps(R.rounds.map((r) => r[1]), 10), R.steps, `${R.night} v1.2 steps from his rounds`);
    const w = QW.walk(R.steps), q = QW.quantumness(R.counts, R.wheel_shots, w.perfect, w.normal);
    assert.equal(q.kept, true, `${R.night} v1.2 re-run kept the quantum pattern`);
    if (R.night === '2026-11-01') assert.ok(Math.abs(q.dq - 0.193) < 0.001 && Math.abs(q.dn - 0.360) < 0.001, `${q.dq} ${q.dn}`);
  }
  const tie = QW.quantumness([2, 2], 4, [0.5, 0.5], [0.5, 0.5]);
  assert.equal(tie.kept, false, 'a tie is not a quantum win');
  assert.throws(() => QW.quantumness(Array(16).fill(0), 0, Array(16).fill(1 / 16), Array(16).fill(1 / 16)), /shots/);
});
