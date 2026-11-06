// node --test quantum/tests/post_night.test.mjs  (pure checks; the send path is exercised on a local anvil by
// contracts/script/anvil-e2e.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import {
  ABI, GAME_RECIPE, nightNumber, turnCounts, stepsFromTurns, inReach, jobIdBytes32, loadWheel, sleptNight, tiersOf,
  TIER_NAMES, calldata, callArgs, describe,
} from '../post_night.mjs';

const Q = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAIN = path.join(Q, '..', 'data', 'chain-nights.json');
// the game's recipe (v1.2) run of the night of 4 Nov; the v1 archive run of the same night sits next to it
const GOOD = path.join(Q, 'wheel-2026-11-04-ibm_marrakesh-dbmbr0hkbkrc73cp7u8g.json');
const GOOD_JOB = 'dbmbr0hkbkrc73cp7u8g';
const V1 = path.join(Q, 'wheel-2026-11-04-ibm_marrakesh-dbmaa9u74qds73dru4d0.json');
const V1_JOB = 'dbmaa9u74qds73dru4d0';
const REJ = path.join(Q, 'rejected', 'wheel-2026-11-04-ibm_fez-dbma7apkbkrc73cp4vo0.json');
const NAME = path.basename(GOOD);

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'post-night-test-')); }
/** A copy of the good file (edited) and of data/chain-nights.json (edited) in a fresh dir; fn(file, chainNightsPath). */
function scenario({ name = NAME, edit = () => {}, chain = (c) => c } = {}, fn) {
  const dir = tmpDir();
  try {
    const d = JSON.parse(fs.readFileSync(GOOD, 'utf8'));
    edit(d);
    const f = path.join(dir, name);
    fs.writeFileSync(f, JSON.stringify(d));
    const cn = path.join(dir, 'chain-nights.json');
    const c = chain(JSON.parse(fs.readFileSync(CHAIN, 'utf8')));
    if (c !== null) fs.writeFileSync(cn, JSON.stringify(c));
    return fn(f, cn, dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const withCopy = (name, edit, fn) => scenario({ name, edit }, (f, cn) => fn(f, cn));
const load = (f, cn, job = GOOD_JOB) => loadWheel(f, { chainNights: cn, job });

test('night number = days since 1970 of the Squeek day start (matches the contract fixtures)', () => {
  assert.equal(nightNumber('2026-11-04'), 20761);
  assert.equal(nightNumber('1970-01-01'), 0);
  assert.equal(nightNumber('2024-02-29'), 19782);
  assert.throws(() => nightNumber('2026-02-30'));
  assert.throws(() => nightNumber('2026-11-4'));
});

test('ring turn: spot = (position + total turns) % 16, like wheel.py turned()', () => {
  const pos = [...Array(16).keys()];
  assert.deepEqual(turnCounts(pos, 3), [13, 14, 15, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(turnCounts(pos, 16), pos);
});

test('the real healthy 4 Nov file (recipe v1.2)', () => {
  const r = loadWheel(GOOD, { job: GOOD_JOB });
  assert.equal(r.n, 20761);
  assert.equal(r.turns, 3817);
  assert.equal(r.ringTurn, 9);
  assert.equal(r.steps, 10);
  assert.equal(r.shots, 4000);
  assert.deepEqual(r.counts, [40, 679, 55, 493, 46, 504, 29, 254, 44, 380, 34, 260, 33, 578, 46, 525]);
  assert.equal(r.jobId, '0x' + Buffer.from(GOOD_JOB).toString('hex').padEnd(64, '0'));
  assert.equal(r.resultSha256, '0x' + crypto.createHash('sha256').update(fs.readFileSync(GOOD)).digest('hex'));
  // the chip's first shot: position 10 (shots_in_order[0]), turned by 3817 -> spot 3
  assert.equal(r.firstPosition, 10);
  assert.equal(r.firstShot, 3);
  // the rank rule: odd spots in reach, all >= 1 %: 1 13 15 5 Common, 3 9 Uncommon, 11 Rare, 7 Epic (the first shot
  // landed on 3, so no Legendary); the even spots are out of reach (spot 0: 40 = 1 %, chip noise)
  const { tiers, rank, n } = tiersOf(r.counts, r.turns, r.steps, r.firstShot);
  assert.deepEqual(tiers, [0, 1, 0, 2, 0, 1, 0, 4, 0, 2, 0, 3, 0, 1, 0, 1]);
  assert.equal(n, 8);
  assert.deepEqual([rank[1], rank[13], rank[7], rank[0]], [1, 2, 8, 0]);
  assert.equal(tiersOf(r.counts, r.turns, r.steps, 7).tiers[7], 5, 'had the first shot landed on spot 7: Legendary');
  assert.deepEqual(callArgs(r), [20761, r.counts, 3817, 10, r.jobId, r.resultSha256, 3]);
  const dec = new ethers.Interface(ABI).decodeFunctionData('postNight', calldata(r));
  assert.equal(Number(dec[3]), 10, 'steps go on-chain');
  assert.equal(Number(dec[6]), 3, 'the first shot goes on-chain');
});

/** a walk of k steps of +1 / -1 from his start (spot T % 16) ends on start + x, x in {-k, -k + 2, ..., k}, mod 16 */
const lands = (s, T, k) => { for (let x = -k; x <= k; x += 2) if ((((T % 16) + x) % 16 + 16) % 16 === s) return true; return false; };

test('reach: (spot + turns + steps) even AND at most `steps` spots from his start around the ring (the contract)', () => {
  // 4 Nov v1.2: 3817 turns, 10 steps -> odd spots in reach; spot 0 (40/4000, 1 %) is out of reach: chip noise, got away
  assert.equal(inReach(1, 3817, 10), true);
  assert.equal(inReach(0, 3817, 10), false);
  // one step from spot 9: only 8 and 10. Spot 12 has the right parity but is 3 spots away (positions 3..13: P = 0)
  for (let s = 0; s < 16; s++) assert.equal(inReach(s, 9, 1), s === 8 || s === 10, `spot ${s}`);
  assert.equal(inReach(12, 9, 1), false);
  for (let s = 0; s < 16; s++) for (const T of [0, 1, 7, 9, 15, 3817, 8505]) for (let k = 0; k <= 16; k++) {
    assert.equal(inReach(s, T, k), lands(s, T, k), `spot ${s} turns ${T} steps ${k}`);
    if (k >= 8) assert.equal(inReach(s, T, k), (s + T + k) % 2 === 0, '8+ steps: the parity rule alone');
  }
  const text = describe(loadWheel(GOOD, { job: GOOD_JOB }));
  assert.match(text, /spot  0: +40 +1\.00 %  got away +out of reach: chip noise$/m, 'out of reach never catches');
  assert.match(text, /spot  1: +679 .*Common +rank 1 of 8 +in reach$/m);
  assert.match(text, /spot  7: +254 .*Epic +rank 8 of 8 +in reach$/m);
  assert.match(text, /spot  6: +29 .*got away +out of reach: chip noise$/m);
  assert.match(text, /^the chip's first shot: position 10 -> spot 3 \(not the Epic spot: no Legendary tonight\)$/m);
  assert.match(text, /^catchable tonight \(in reach, >= 1 %\): 8 spots, ranked by landings$/m);
  assert.doesNotMatch(text, /^ +spot .*Legendary/m, 'no Legendary on this night');
  assert.doesNotMatch(text, /noise hatch/);
  assert.match(text, /^postNight\(20761, \[40, 679, .*, 525\], 3817, 10, 0x[0-9a-f]{64}, 0x[0-9a-f]{64}, 3\)$/m);
});

test('reach matches wheel.py ideal_walk on every spot (contracts/test/data/reach-vectors.json)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(Q, '..', 'contracts', 'test', 'data', 'reach-vectors.json'), 'utf8'));
  assert.ok(v.k.length > 500);
  for (let i = 0; i < v.k.length; i++) {
    for (let s = 0; s < 16; s++) assert.equal(inReach(s, v.turns[i], v.k[i]), ((v.mask[i] >> s) & 1) === 1, `vector ${i} spot ${s}`);
  }
  for (const c of v.known) for (let s = 0; s < 16; s++) assert.equal(inReach(s, c.turns, c.k), ((c.rule >> s) & 1) === 1, c.why);
});

test('the dry run prints reach by the contract rule on a short night', () => {
  // made-up 1-step night from spot 9: 8 and 10 in reach; 12 (2.5 %) is chip noise 3 spots away
  const counts = new Array(16).fill(0); counts[8] = 3600; counts[10] = 300; counts[12] = 100;
  const r = { kind: 'ran', date: '2026-11-09', n: 20766, backend: 'x', job: 'j', recipe: GAME_RECIPE, counts, posCounts: counts,
    shots: 4000, turns: 9, ringTurn: 9, steps: 1, firstShot: 8, jobId: jobIdBytes32('j'), resultSha256: ethers.ZeroHash };
  const text = describe(r);
  assert.match(text, /spot  8: +3600 .*Rare +rank 1 of 2 +in reach$/m);
  assert.match(text, /spot 10: +300 .*Epic +rank 2 of 2 +in reach$/m);
  assert.match(text, /^the chip's first shot: spot 8 \(not the Epic spot: no Legendary tonight\)$/m);
  assert.match(describe({ ...r, firstShot: 10 }), /spot 10: +300 .*Legendary +rank 2 of 2 +in reach$/m);
  assert.match(text, /spot  3: +0 .*got away +out of reach: no landings$/m);
  assert.match(text, /spot 12: +100 .*got away +out of reach: chip noise$/m);
  assert.match(text, /his total turns 9 -> ring turn 9; 1 step; 4000 shots/);
  assert.match(text, /^in reach tonight \(the right parity, within 1 spot of his start, spot 9\): 8, 10$/m);
  const real = describe(loadWheel(GOOD, { job: GOOD_JOB }));
  assert.match(real, /^in reach tonight \(the right parity, within 10 spots of his start, spot 9\): 1, 3, 5, 7, 9, 11, 13, 15$/m);
});

test('steps: wheel.py steps_from_w (cap 10, groups of consecutive rounds, mean rounded half up)', () => {
  assert.deepEqual(stepsFromTurns([0, 5, 0, 7], 10), [5, 7]);
  assert.deepEqual(stepsFromTurns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 10), [2, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  assert.deepEqual(stepsFromTurns([1, 2, 2, 2], 2), [2, 2]); // 1.5 -> 2 (half up), 2
});

test('two healthy files for one night: refuses unless --job names the one to post', () => {
  assert.throws(() => loadWheel(GOOD), /2 result files for the night of 2026-11-04.*--job/s);
  assert.throws(() => loadWheel(GOOD, { job: V1_JOB }), /--job/);
  assert.equal(loadWheel(GOOD, { job: GOOD_JOB }).job, GOOD_JOB);
  // a second healthy file next to the one being posted, even with other counts, is caught too
  scenario({ name: 'wheel-2026-11-09-ibm_marrakesh-aaa.json', edit: (d) => Object.assign(d, { night: '2026-11-09', job_id: 'aaa' }),
    chain: (c) => { c.nights['2026-11-09'] = { ...c.nights['2026-11-04'] }; return c; } }, (f, cn, dir) => {
    load(f, cn, 'aaa');
    fs.copyFileSync(f, path.join(dir, 'wheel-2026-11-09-ibm_marrakesh-bbb.json'));
    assert.throws(() => loadWheel(f, { chainNights: cn }), /2 result files/);
    assert.equal(load(f, cn, 'aaa').job, 'aaa');
  });
});

test('fails closed when data/chain-nights.json cannot vouch for the night', () => {
  scenario({ edit: (d) => { d.rounds[0][1] += 1; }, chain: () => null }, (f, cn) => {
    assert.throws(() => load(f, cn), /chain-nights.*missing|no such file/i, 'missing chain-nights.json');
  });
  scenario({ edit: (d) => { d.rounds[0][1] += 1; }, chain: () => ({ nights: {} }) }, (f, cn) => {
    assert.throws(() => load(f, cn), /not in/, 'night not listed');
  });
  scenario({ chain: (c) => { c.nights['2026-11-04'].complete = false; return c; } }, (f, cn) => {
    assert.throws(() => load(f, cn), /not complete/);
  });
  // an invented night that no chain record backs
  scenario({ name: 'wheel-2026-11-09-ibm_marrakesh-aaa.json',
    edit: (d) => Object.assign(d, { night: '2026-11-09', job_id: 'aaa', rounds: [[1, 5], [2, 7]], steps: [5, 7] }) }, (f, cn) => {
    assert.throws(() => load(f, cn, 'aaa'), /not in/);
  });
});

test('the file must match the chain record: core, every round, steps', () => {
  scenario({ edit: (d) => { d.core = '0x000000000000000000000000000000000000dEaD'; } }, (f, cn) => {
    assert.throws(() => load(f, cn), /core/);
  });
  scenario({ edit: (d) => { d.core = d.core.toUpperCase().replace('0X', '0x'); } }, (f, cn) => load(f, cn)); // case only
  scenario({ edit: (d) => { d.rounds[0][1] += 1; } }, (f, cn) => assert.throws(() => load(f, cn), /rounds/));
  // same total, different rounds: a sum check would miss it
  scenario({ edit: (d) => { d.rounds[0][1] += 1; d.rounds[1][1] -= 1; } }, (f, cn) => assert.throws(() => load(f, cn), /rounds/));
  scenario({ edit: (d) => { d.rounds[0][0] += 1000; } }, (f, cn) => assert.throws(() => load(f, cn), /rounds/));
  scenario({ edit: (d) => { d.steps[0] += 1; } }, (f, cn) => assert.throws(() => load(f, cn), /steps/));
  scenario({ edit: (d) => { d.steps.pop(); } }, (f, cn) => assert.throws(() => load(f, cn), /steps/));
});

test('recipe must be the game recipe (v1.2), also for real archive files', () => {
  assert.throws(() => loadWheel(V1, { job: V1_JOB }), /recipe/);
  scenario({ edit: (d) => { d.recipe = 'not-a-recipe'; } }, (f, cn) => assert.throws(() => load(f, cn), /recipe/));
  const py = fs.readFileSync(path.join(Q, 'wheel.py'), 'utf8');
  const m = /^RECIPE = '([^']+)'/m.exec(py);
  assert.ok(m, 'wheel.py has RECIPE');
  assert.equal(GAME_RECIPE, `wheel_spec.md ${m[1]}`, 'post_night GAME_RECIPE follows wheel.py RECIPE');
  assert.match(py, /^N, CAP, MAX_TURNS = 16, 10, 700$/m, 'the step cap the poster recomputes with');
});

test('tiers: the contract rank rule on every vector of contracts/test/data/tier-vectors.json (9 real nights + synthetic)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(Q, '..', 'contracts', 'test', 'data', 'tier-vectors.json'), 'utf8'));
  assert.ok(v.turns.length > 700);
  let legendary = 0;
  for (let i = 0; i < v.turns.length; i++) {
    const c = v.counts.slice(16 * i, 16 * i + 16), want = v.tier.slice(16 * i, 16 * i + 16);
    const { tiers } = tiersOf(c, v.turns[i], v.steps[i], v.first[i]);
    assert.deepEqual(tiers, want, `vector ${i}`);
    legendary += tiers.filter((t) => t === 5).length;
  }
  assert.ok(legendary > 50);
  assert.deepEqual(TIER_NAMES, [null, 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']);
  // ties: the lower spot ranks first; 1 % exactly is catchable
  const c = new Array(16).fill(0); c[0] = 2000; c[2] = 2000; // start 0, 2 steps: 14, 0, 2 in reach
  assert.deepEqual([0, 2].map((s) => tiersOf(c, 16, 2, 0).tiers[s]), [3, 4]);
  c[0] = 3960; c[2] = 40;
  assert.equal(tiersOf(c, 16, 2, 2).tiers[2], 5);
  c[0] = 3961; c[2] = 39;
  assert.equal(tiersOf(c, 16, 2, 2).tiers[2], 0);
});

test('the first shot: required (shots_in_order) and turned onto the ring like the counts', () => {
  withCopy(NAME, (d) => { delete d.shots_in_order; }, (f, cn) => assert.throws(() => load(f, cn), /shots_in_order is missing/));
  withCopy(NAME, (d) => { d.shots_in_order = d.shots_in_order.slice(1); }, (f, cn) => assert.throws(() => load(f, cn), /shots_in_order/));
  // swap the first shot with a later one on another position: still adds up; the first shot follows
  withCopy(NAME, (d) => {
    const j = d.shots_in_order.findIndex((p) => p === 2);
    [d.shots_in_order[0], d.shots_in_order[j]] = [d.shots_in_order[j], d.shots_in_order[0]];
  }, (f, cn) => {
    const r = load(f, cn);
    assert.equal(r.firstPosition, 2);
    assert.equal(r.firstShot, (2 + 3817) % 16);
    assert.equal(callArgs(r)[6], 11);
  });
});

test('refuses files under rejected/', () => {
  assert.throws(() => loadWheel(REJ), /rejected/);
});

test('refuses healthy !== true even outside rejected/', () => {
  for (const v of [false, 'true', 1, undefined]) {
    withCopy(NAME, (d) => { d.healthy = v; }, (f, cn) => {
      assert.throws(() => load(f, cn), /healthy/);
    });
  }
});

test('refuses inconsistent files', () => {
  withCopy(NAME, (d) => { d.counts[0] += 1; }, (f, cn) => assert.throws(() => load(f, cn), /wheel_shots|shots_in_order/));
  withCopy(NAME, (d) => { d.night = '2026-11-03'; }, (f, cn) => assert.throws(() => load(f, cn), /disagree/));
  withCopy(NAME, (d) => { d.twin = d.twin.map((p) => ({ ...p, wins: 40 })); }, (f, cn) => assert.throws(() => load(f, cn), /twin/));
  withCopy('wheel-2026-11-04-ibm_marrakesh-x.json', () => {}, (f, cn) => assert.throws(() => load(f, cn, 'x'), /disagree/));
  withCopy('notes.json', () => {}, (f, cn) => assert.throws(() => load(f, cn), /not a wheel/));
});

test('job id: ASCII right-padded, refuses what would not fit or render', () => {
  assert.equal(jobIdBytes32('abc'), '0x616263' + '0'.repeat(58));
  assert.throws(() => jobIdBytes32('a'.repeat(32)));
  assert.throws(() => jobIdBytes32('a"b'));
  assert.throws(() => jobIdBytes32(''));
});

test('--slept needs a complete night with zero turns in chain-nights.json and no result file', () => {
  const dir = tmpDir();
  try {
    const cn = path.join(dir, 'chain-nights.json');
    fs.writeFileSync(cn, JSON.stringify({ nights: {
      '2026-11-04': { complete: true, rounds: [] },
      '2026-11-06': { complete: true, rounds: [] },
      '2026-11-07': { complete: false, rounds: [] },
      '2026-11-08': { complete: true, rounds: [{ id: 1, turns: 5 }] },
    } }));
    const r = sleptNight('2026-11-06', { chainNights: cn });
    assert.equal(r.n, 20763);
    assert.equal(r.turns, 0);
    assert.equal(r.steps, 0);
    assert.deepEqual(r.counts, new Array(16).fill(0));
    assert.deepEqual(callArgs(r), [20763, r.counts, 0, 0, ethers.ZeroHash, ethers.ZeroHash, 0]);
    assert.throws(() => sleptNight('2026-11-07', { chainNights: cn }), /not complete/);
    assert.throws(() => sleptNight('2026-11-08', { chainNights: cn }), /he ran/);
    assert.throws(() => sleptNight('2026-11-09', { chainNights: cn }), /not in/);
    // quantum/ holds chip result files for 4 Nov: "he slept" would contradict them
    assert.throws(() => sleptNight('2026-11-04', { chainNights: cn }), /result file/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
