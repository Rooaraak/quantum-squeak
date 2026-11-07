// Quantum Catch logic (wheel/catch.js): the night clock and the 21:00 UTC net lock (same rules as contracts/src/QuantumCatch.sol),
// local nets (one per night), token ids, hand-made ABI encoding/decoding, the wallet flow against a mocked EIP-1193 provider
// (v2, no picking: castNet() without a spot, the drawn spot read back once posted; free nets; nets paid with 0.01 test SQK:
// permit, allowance, approve fallback, NO_SQK; the v1 pick-a-spot contract refused; the test SQK faucet, once per night),
// and the live SqueekCore read (decoded from a real recorded Sepolia response). Reach and rarity (the owner's rules) are
// checked against the Python reference wheel/test/tier_ref.py on every spot.   node --test wheel/test/catch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = new URL('.', import.meta.url).pathname;
const ROOT = path.resolve(here, '../..');
const QC = require(here + '../catch.js');
const QW = require(here + '../engine.js');
const FIX = JSON.parse(fs.readFileSync(here + 'fixtures/squeekcore-2026-11-04.json', 'utf8'));
const CHAIN = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chain-nights.json'), 'utf8')).nights;
const REF = JSON.parse(execFileSync('python3', [here + 'tier_ref.py'], { encoding: 'utf8', maxBuffer: 64 << 20 }));   // the Python reference
const pad = (x) => BigInt(x).toString(16).padStart(64, '0');
const ADDR = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';           // anvil's well-known test account 1 (no value anywhere)
const CONTRACT = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const NOV4 = 1793793600;                                               // 4 Nov 2026 12:00 UTC: night 20761 starts
// ethers (optional, only to cross-check the hand-made encoding): ETHERS_PATH, else data/local.json {"ethers": ...}
const ethers = await (async () => {
  let spec = process.env.ETHERS_PATH;
  if (!spec) try { spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/local.json'), 'utf8')).ethers; } catch (e) { /* none */ }
  if (!spec) return null;
  try { return (await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec)).ethers; } catch (e) { return null; }
})();

test('night clock: night(t) = (t - 43200) / 86400, nights are days since 1970 (night 20761 = 4 Nov 2026)', () => {
  assert.equal(QC.nightOf(NOV4), 20761);
  assert.equal(QC.nightOf(NOV4 - 1), 20760);
  assert.equal(QC.nightStart(20761), NOV4);
  assert.equal(QC.dayOf(20761), '2026-11-04');
  assert.equal(QC.nightOfDay('2026-11-04'), 20761);
  assert.equal(QC.nightOfDay('2026-10-29'), 20755);
  assert.equal(QC.closeAt(20761), NOV4 + 32400, 'nets close at 21:00 UTC');
  assert.equal(new Date(QC.closeAt(20761) * 1000).toISOString(), '2026-11-04T21:00:00.000Z');
});

test('open night (contract openNightAt): before 21:00 UTC the same night, from 21:00 on the next one; mornings belong to the coming night', () => {
  assert.equal(QC.openNight(NOV4 + 32400 - 1), 20761, '20:59:59 UTC: still tonight');
  assert.equal(QC.openNight(NOV4 + 32400), 20762, '21:00:00 UTC: the lock, nets roll to the next night');
  assert.equal(QC.openNight(NOV4 - 6 * 3600), 20761, '4 Nov 06:00 UTC: the 3 Nov night is still running, nets are for 4 Nov');
  assert.equal(QC.openNight(NOV4), 20761);
  assert.equal(QC.openNight(NOV4 + 86400 - 1), 20762);
  assert.throws(() => QC.openNight(100), /time/);
});

test('no chip result for good (contract status 4): 14 days after the night ends', () => {
  assert.equal(QC.postDeadline(20761), NOV4 + 86400 + 14 * 86400);
  assert.equal(QC.noResult(20761, NOV4 + 15 * 86400 - 1), false);
  assert.equal(QC.noResult(20761, NOV4 + 15 * 86400), true);
});

test('net window: closing time, countdown, tonight vs tomorrow in the viewer\'s own day, his usual start', () => {
  const t = Date.parse('2026-11-05T17:30:00Z');
  const w = QC.netWindow(t, 60);                                      // a viewer at UTC+1
  assert.equal(w.day, '2026-11-05'); assert.equal(w.n, 20762); assert.equal(w.when, 'tonight');
  assert.equal(w.closeMs, Date.parse('2026-11-05T21:00:00Z')); assert.equal(w.leftMs, 3.5 * 3600e3);
  assert.deepEqual([w.startFromMs, w.startToMs], [Date.parse('2026-11-05T21:10:00Z'), Date.parse('2026-11-05T21:40:00Z')]);
  const late = QC.netWindow(Date.parse('2026-11-05T21:30:00Z'), 60);
  assert.equal(late.day, '2026-11-06'); assert.equal(late.when, 'tomorrow', 'after the lock: tomorrow\'s net');
  const ny = QC.netWindow(Date.parse('2026-11-06T00:30:00Z'), -300);  // 19:30 on 5 Nov at UTC-5: the 6 Nov net closes 16:00 tomorrow
  assert.equal(ny.day, '2026-11-06'); assert.equal(ny.when, 'tomorrow');
  const morning = QC.netWindow(Date.parse('2026-11-06T07:00:00Z'), 60);
  assert.equal(morning.day, '2026-11-06'); assert.equal(morning.when, 'tonight');
  assert.equal(QC.countdown(3.5 * 3600e3), '3 h 30 min');
  assert.equal(QC.countdown(42 * 60e3 + 5e3), '42 min');
  assert.equal(QC.countdown(61e3), '1 min 1 s');
  assert.equal(QC.countdown(59e3), '59 s');
  assert.equal(QC.countdown(-5), '0 s');
});

test('local nets: one per night, final once cast; after the lock a new net goes to the next night; never for a night already in the page', () => {
  const store = {};
  const built = new Set(['2026-11-04']), isBuilt = (d) => built.has(d);
  const t = Date.parse('2026-11-05T17:30:00Z');
  assert.deepEqual(QC.castLocal(store, t, 6, isBuilt), { ok: true, day: '2026-11-05' });
  assert.deepEqual(store.nets['2026-11-05'], { spot: 6, at: t });
  assert.deepEqual(QC.castLocal(store, t + 60e3, 9, isBuilt), { ok: false, day: '2026-11-05', why: 'already' }, 'one net per night, no moving it');
  assert.equal(store.nets['2026-11-05'].spot, 6);
  assert.deepEqual(QC.castLocal(store, Date.parse('2026-11-05T21:00:00Z'), 9, isBuilt), { ok: true, day: '2026-11-06' }, 'from 21:00 UTC: the next night');
  built.add('2026-11-07');
  assert.equal(QC.castLocal(store, Date.parse('2026-11-07T10:00:00Z'), 1, isBuilt).why, 'closed', 'a night already in the page is closed');
  for (const bad of [16, -1, 2.5, '3', null]) assert.equal(QC.castLocal({}, t, bad, isBuilt).why, 'spot');
  assert.equal(QC.castLocal({ nets: 'x' }, t, 3, isBuilt).ok, true, 'a broken store is replaced');
});

test('token id = (night << 160) | wallet, 32-byte hex; the low 160 bits are the caster', () => {
  const id = QC.netId(20761, ADDR);
  assert.match(id, /^0x[0-9a-f]{64}$/);
  assert.equal(BigInt(id) >> 160n, 20761n);
  assert.equal('0x' + (BigInt(id) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0'), ADDR);
  assert.equal(QC.netId(20761, ADDR.toUpperCase().replace('0X', '0x')), id, 'checksum case does not matter');
  assert.throws(() => QC.netId(20761, '0x1234'), /address/);
  if (ethers) assert.equal(id, '0x' + pad((20761n << 160n) | BigInt(ADDR)));
});

test('ABI encoding by hand: selectors (= forge methodIdentifiers) and arguments', () => {
  assert.equal(QC.enc.castNet(), '0x0612a854', 'castNet(): no argument (no picking)');
  for (const bad of [15, 0, '2']) assert.throws(() => QC.enc.castNet(bad), /no spot/, 'a spot is refused, never sent');
  const id = QC.netId(20761, ADDR);
  assert.equal(QC.enc.result(id), '0x3c594059' + id.slice(2));
  assert.equal(QC.enc.tokenURI(id), '0xc87b56dd' + id.slice(2));
  assert.equal(QC.enc.state(), '0xc19d93fb');
  assert.ok(FIX.calls[QC.enc.roundPage(97, 241, 16)], 'roundPage(97, 241, 16) is the recorded call');
  assert.throws(() => QC.enc.roundPage(97, 241, 17), /16/);
  const out = path.join(ROOT, 'contracts/out/QuantumCatch.sol/QuantumCatch.json');
  if (fs.existsSync(out)) {
    const m = JSON.parse(fs.readFileSync(out, 'utf8')).methodIdentifiers;
    assert.equal(QC.SEL.castNet, '0x' + m['castNet()']); assert.equal(QC.SEL.result, '0x' + m['result(uint256)']); assert.equal(QC.SEL.tokenURI, '0x' + m['tokenURI(uint256)']);
    assert.equal(m['castNet(uint8)'], undefined, 'the build has no pick-a-spot castNet');
  }
  if (ethers) {
    for (const [k, sig] of [['castNet', 'castNet()'], ['result', 'result(uint256)'], ['tokenURI', 'tokenURI(uint256)'], ['state', 'state()'], ['roundPage', 'roundPage(uint64,uint64,uint256)']]) assert.equal(QC.SEL[k], ethers.id(sig).slice(0, 10), sig);
    assert.equal(QC.TOPIC_NETCAST, ethers.id('NetCast(uint32,address,uint256)'));
    assert.equal(QC.ERR.AlreadyCast, ethers.id('AlreadyCast(uint32,address)').slice(0, 10));
    assert.equal(QC.ERR.NonexistentToken, ethers.id('NonexistentToken(uint256)').slice(0, 10));
  }
});

test('decoding result(), strings, NetCast logs and on-chain metadata', () => {
  const r = QC.dec.result('0x' + [1, 20761, 15, 808, 4000, 1, 15].map(pad).join(''));
  assert.deepEqual(r, { status: 1, night: 20761, spot: 15, hits: 808, shots: 4000, tier: 1, looks: 15 }, 'caught: the drawn spot and its tier');
  assert.deepEqual(QC.dec.result('0x' + [0, 20762, 255, 0, 0, 0, 0].map(pad).join('')), { status: 0, night: 20762, spot: null, hits: 0, shots: 0, tier: 0, looks: 0 }, 'waiting: no spot drawn yet (NO_SPOT 255 on chain)');
  assert.deepEqual(QC.dec.result('0x' + [2, 20761, 0, 27, 4000, 0, 0].map(pad).join('')), { status: 2, night: 20761, spot: 0, hits: 27, shots: 4000, tier: 0, looks: 0 }, 'got away: its shot\'s spot, no looks');
  assert.equal(QC.NO_SPOT, 255);
  assert.throws(() => QC.dec.result('0x' + pad(1)), /short/);
  const word = (s) => Buffer.from(s, 'utf8').toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
  const str = (s) => '0x' + pad(32) + pad(Buffer.byteLength(s)) + word(s);
  assert.equal(QC.dec.string(str('hello')), 'hello');
  assert.equal(QC.dec.string(str('Quantum Catch · night of 2026-11-04 · ✓')), 'Quantum Catch · night of 2026-11-04 · ✓');
  const id = QC.netId(20762, ADDR);
  const log = { address: CONTRACT, topics: [QC.TOPIC_NETCAST, '0x' + pad(20762), '0x' + pad(ADDR)], data: '0x' + id.slice(2) };
  assert.deepEqual(QC.dec.netCast(log), { night: 20762, catcher: ADDR, tokenId: id }, 'NetCast(night, catcher, tokenId): no spot');
  assert.equal(QC.dec.netCast({ ...log, topics: ['0x' + pad(1), ...log.topics.slice(1)] }), null, 'other events are not a NetCast');
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const meta = { name: 'Quantum Catch: night of 2026-11-05, spot 6', attributes: [{ trait_type: 'Status', value: 'Waiting' }], image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64') };
  const m = QC.tokenMeta('data:application/json;base64,' + Buffer.from(JSON.stringify(meta)).toString('base64'));
  assert.equal(m.name, meta.name); assert.equal(m.image, meta.image); assert.equal(m.attr.Status, 'Waiting');
  assert.equal(QC.tokenMeta('data:application/json;base64,' + Buffer.from(JSON.stringify({ ...meta, image: 'https://example.org/x.svg' })).toString('base64')).image, null, 'never an outside image');
  assert.equal(QC.tokenMeta('https://example.org/meta.json'), null, 'only on-chain data: metadata');
});

test('outcome of a net (contract result() rules): waiting, caught with the night\'s rank tier, got away under 1 % or out of reach, he slept', () => {
  const counts = [27, 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808];   // 4 Nov chip landings per SPOT
  const nov4 = { counts, shots: 4000, turns: 3817, steps: 14, firstShot: 15 };               // his 4 Nov night: odd spots in reach
  assert.deepEqual(QC.outcome(null, 5), { status: 0, hits: 0, shots: 0, tier: 0, reach: 0 });
  assert.deepEqual(QC.outcome({ slept: true }, 5), { status: 3, hits: 0, shots: 0, tier: 0, reach: 0 });
  // ranked by landings: 15 3 1 9 Common | 7 5 Uncommon | 13 Rare | 11 Epic (the fewest of the 8 catchable spots)
  assert.deepEqual(QC.outcome(nov4, 15), { status: 1, hits: 808, shots: 4000, tier: 1, reach: 1 });
  assert.deepEqual(QC.outcome(nov4, 0), { status: 2, hits: 27, shots: 4000, tier: 0, reach: 2 });
  assert.deepEqual(QC.outcome(nov4, 5), { status: 1, hits: 308, shots: 4000, tier: 2, reach: 1 });
  assert.deepEqual(QC.outcome(nov4, 13), { status: 1, hits: 292, shots: 4000, tier: 3, reach: 1 });
  assert.deepEqual(QC.outcome(nov4, 11), { status: 1, hits: 289, shots: 4000, tier: 4, reach: 1 }, 'Epic: the first shot was on 15');
  assert.deepEqual(QC.outcome({ ...nov4, firstShot: 11 }, 11), { status: 1, hits: 289, shots: 4000, tier: 5, reach: 1 }, 'the first shot on the Epic spot: Legendary');
  assert.equal(QC.outcome({ ...nov4, firstShot: 13 }, 13).tier, 3, 'the first shot on the Rare spot: still Rare');
  assert.throws(() => QC.outcome({ counts, shots: 4000 }, 5), /turns and steps/, 'reach needs the night: never guessed');
  assert.throws(() => QC.outcome({ counts, shots: 4000, turns: 3817, steps: 14 }, 5), /first shot/, 'Legendary needs the first shot: never guessed');
  // the 1 % line, integer compare as the contract (hits * 100 >= shots): start 2, 2 steps, spots 0, 2, 4 in reach
  for (let h = 30; h <= 50; h++) {
    const c = Array(16).fill(0); c[0] = h; c[2] = 4000 - h;
    const o = QC.outcome({ counts: c, shots: 4000, turns: 2, steps: 2, firstShot: 2 }, 0);
    assert.deepEqual([o.status, o.tier, o.hits, o.reach], h >= 40 ? [1, 4, h, 1] : [2, 0, h, 1], `${h}/4000: ${h >= 40 ? 'the Epic catch' : 'got away'}`);
    const x = QC.outcome({ counts: c, shots: 4000, turns: 3, steps: 2, firstShot: 1 }, 0);                         // spot 0 out of reach
    assert.deepEqual([x.status, x.tier, x.hits, x.reach], [2, 0, h, 2], `${h}/4000 out of reach: got away, landings kept`);
  }
  const tie = Array(16).fill(0); tie[0] = 2000; tie[2] = 2000;
  assert.deepEqual([0, 2].map((s) => QC.outcome({ counts: tie, shots: 4000, turns: 2, steps: 2, firstShot: 0 }, s).tier), [3, 4], 'equal landings: the lower spot ranks first, the higher is Epic');
});

test('reach and tiers (QC.inReach, QC.tiersOf = the contract\'s _inReach / tiersOf): the Python reference on every spot, real and synthetic', () => {
  assert.equal(REF.real.length, 9);
  for (const x of [...REF.real, ...REF.synth]) {
    for (let s = 0; s < 16; s++) assert.equal(QC.inReach(s, x.turns, x.steps), x.reach[s], `${x.file || x.why}: reach of spot ${s}`);
    assert.deepEqual(QC.tiersOf(x.counts, x.turns, x.steps, x.first), x.tiers, `${x.file || x.why}: tier codes ${JSON.stringify(x)}`);
    assert.deepEqual(QW.tiers(x.counts, x.turns, x.steps, x.first), x.tiers.map((c) => c - 1), 'the engine (page) and catch.js (contract mirror) agree');
  }
  for (let turns = 0; turns < 40; turns++) for (let steps = 0; steps <= 16; steps++) for (let s = 0; s < 16; s++) {
    const d = Math.min(Math.abs(s - (turns % 16)), 16 - Math.abs(s - (turns % 16)));
    assert.equal(QC.inReach(s, turns, steps), (s + turns + steps) % 2 === 0 && d <= steps, `${s} ${turns} ${steps}`);
    assert.equal(QC.inReach(s, turns, steps), QW.inReach(s, turns, steps));
  }
  assert.equal(QC.tierOf, undefined, 'the share tiers are gone');
});

// the contract's own tier vectors (contracts/test/data/tier-vectors.json, made by contracts/test/data/make_tier_vectors.py,
// the contract's Python reference): read-only, as a cross-check that the page and the contract follow the same rule
test('reach and tiers: the contract\'s tier vectors, when present in the rarity-rule format', (ctx) => {
  const tv = path.join(ROOT, 'contracts/test/data/tier-vectors.json');
  const V = fs.existsSync(tv) ? JSON.parse(fs.readFileSync(tv, 'utf8')) : null;
  if (!V || !Array.isArray(V.counts) || !Array.isArray(V.first)) { ctx.diagnostic('contracts/test/data/tier-vectors.json missing or not in the rarity-rule format: skipped'); return; }
  const n = V.turns.length;
  assert.ok(n > 100 && V.counts.length === 16 * n && V.tier.length === 16 * n && V.steps.length === n && V.first.length === n);
  for (let i = 0; i < n; i++) {
    const c = V.counts.slice(16 * i, 16 * i + 16);
    assert.deepEqual(QC.tiersOf(c, V.turns[i], V.steps[i], V.first[i]), V.tier.slice(16 * i, 16 * i + 16), `contract vector ${i}`);
  }
});

// the contract's own out-of-reach vector (contracts/test, 183b8ee): the real 31 Oct night, spot 0 got 46 of 4,000 landings
// (1.15 %, Legendary by share) but is out of reach that night, so the net got away with tier 0
const CHIPS = fs.readdirSync(path.join(ROOT, 'quantum')).filter((f) => /^wheel-2026-.*\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'quantum', f), 'utf8')));
const perSpot = (R) => QW.turned(R.counts, QW.ringTurn(R.rounds.map((r) => r[1])));
const firstSpot = (R) => QW.spotOf(R.shots_in_order[0], QW.ringTurn(R.rounds.map((r) => r[1])));
const nightRec = (R) => ({ counts: perSpot(R), shots: R.wheel_shots, turns: R.rounds.reduce((a, r) => a + r[1], 0), steps: R.steps.length, firstShot: firstSpot(R) });
test('reach rule on the real 31 Oct night: spot 0 (46/4000) and spot 2 (51/4000) are out of reach, so they got away', () => {
  const R = CHIPS.find((r) => r.night === '2026-10-31'), rec = nightRec(R);
  assert.equal(rec.counts[0], 46); assert.equal(rec.counts[2], 51); assert.equal(rec.steps, 16);
  assert.deepEqual(QC.outcome(rec, 0), { status: 2, hits: 46, shots: 4000, tier: 0, reach: 2 });
  assert.deepEqual(QC.outcome(rec, 2), { status: 2, hits: 51, shots: 4000, tier: 0, reach: 2 });
  assert.ok(46 * 100 >= 4000, 'by share alone (1.15 %) it would have been catchable');
  for (let s = 0; s < 16; s++) {
    const o = QC.outcome(rec, s);
    assert.equal(o.reach === 1, s % 2 === 1, `31 Oct: the odd spots are in reach (spot ${s})`);
    if (o.reach === 1) assert.equal(o.status, 1, `every spot in reach caught that night (spot ${s}, ${o.hits})`);
  }
});

test('page engine and contract rule agree on every spot of every real chip run (incl. the v1.2 re-runs) = the Python reference', () => {
  let out1 = 0;
  assert.equal(CHIPS.length, 9);
  for (const R of CHIPS) {
    const rec = nightRec(R), T = QW.ringTurn(R.rounds.map((r) => r[1])), k = R.steps.length, ref = REF.real.find((x) => x.job_id === R.job_id);
    assert.ok(ref, `${R.job_id} in the Python reference`);
    assert.deepEqual([rec.counts, rec.turns, rec.steps, rec.firstShot], [ref.counts, ref.turns, ref.steps, ref.first], `${R.night} ${R.job_id}: the same night`);
    const t = QW.tiers(rec.counts, rec.turns, rec.steps, rec.firstShot);
    for (let s = 0; s < 16; s++) {
      const r = QW.reachable((s - T + 16) % 16, k), o = QC.outcome(rec, s);
      assert.equal(r, o.reach === 1, `${R.night} ${R.job_id} spot ${s}: same reach`);
      assert.equal(r, ref.reach[s], `${R.night} ${R.job_id} spot ${s}: reach = Python`);
      assert.equal(t[s] + 1, o.tier, `${R.night} ${R.job_id} spot ${s}: same tier`);
      assert.equal(o.tier, ref.tiers[s], `${R.night} ${R.job_id} spot ${s}: tier = Python`);
      assert.equal(t[s] >= 0, o.status === 1, `${R.night} ${R.job_id} spot ${s}: caught on both or on neither`);
      if (!r && rec.counts[s] * 100 >= rec.shots) out1++;
    }
  }
  assert.ok(out1 >= 30, `the real runs have many out-of-reach spots at 1 % or more (${out1}): none of them catches`);
});

// ---------- the wallet flow, against a mocked EIP-1193 provider ----------
// The mock is the wallet plus a small chain: the QuantumCatch contract (CONTRACT: by default a v2 game with free nets,
// NET_COST() = 0; o.netCost = a v2 contract that charges; o.v1 = the live v1 pick-a-spot contract, whose NET_COST() reverts),
// the test SQK token (SQK, the real Sepolia address, as the page sees it) and the faucet (FAUCET, a stand-in address).
// Only the wallet methods the page needs are allowed.
const ALLOWED = new Set(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_sendTransaction', 'eth_getTransactionReceipt', 'eth_signTypedData_v4']);
const SQK = '0xd78a3956cf63164d1fa1c622ad3c66623162fa1e';                // the test SQK token on Sepolia (public, no value)
const FAUCET = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';             // a stand-in faucet (anvil's second contract address)
const CENT = 10n ** 16n;                                                 // 0.01 test SQK: what a v2 net costs
const DRIP = 10n ** 16n;                                                 // 0.01 test SQK: the faucet's drip (one net a night)
// the real token's DOMAIN_SEPARATOR() (the keccak hash of its EIP-712 domain), read from Sepolia on 6 Nov 2026
const DOMAIN_HASH = '0x2cc99df9c423e838a7b45ff60b5ee38a' + 'd122ea209dca8da37a8d2f3befdf0017';
// the real token's eip712Domain() answer, recorded from Sepolia on 6 Nov 2026 (block 12076658): fields 0x0f (name, version,
// chainId, verifyingContract), "Squeek", "1", 11155111, the token itself, no salt, no extensions
const DOMAIN_RAW = '0x0f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000aa36a7000000000000000000000000d78a3956cf63164d1fa1c622ad3c66623162fa1e00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000160000000000000000000000000000000000000000000000000000000000000000653717565656b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000131000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }];
const PERMIT_TYPES = [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }];
const sel = (d) => d.slice(0, 10);
const word = (d, i) => BigInt('0x' + d.slice(10 + 64 * i, 74 + 64 * i));
const wordHex = (d, i) => '0x' + d.slice(10 + 64 * i, 74 + 64 * i);
const strRet = (s) => '0x' + pad(32) + pad(Buffer.byteLength(s)) + Buffer.from(s, 'utf8').toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
const strTail = (s) => pad(Buffer.byteLength(s)) + Buffer.from(s, 'utf8').toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
const revert = (data) => Object.assign(new Error('execution reverted'), { code: 3, data });
// how browser wallets often hand an eth_call revert back: wrapped, the code and the words one level down
const wrapped = (data) => ({ code: -32603, message: 'Internal JSON-RPC error.', data: { code: 3, message: 'execution reverted', data } });
// an eip712Domain() answer, encoded by hand: fields byte, name, version, chainId, verifyingContract, salt, extensions
const domainRet = ({ fields, name = '', version = '', chainId = 0n, vc = '0x' + '0'.repeat(40), salt = 0n, ext = [] }) => {
  const nameT = strTail(name), verT = strTail(version), at = 7 * 32;
  return '0x' + fields.toString(16).padStart(2, '0').padEnd(64, '0') + pad(at) + pad(at + nameT.length / 2) + pad(chainId) + pad(vc) + pad(salt)
    + pad(at + nameT.length / 2 + verT.length / 2) + nameT + verT + pad(ext.length) + ext.map(pad).join('');
};
function mockWallet(o = {}) {
  const calls = [], me = (o.account || ADDR).toLowerCase(), cost = o.v1 ? null : (o.netCost ?? 0n), token = o.sqkAddr || SQK;   // cost null: the v1 contract
  let chain = o.chain || '0x1', nsent = 0;
  const polls = {}, txs = {};
  const st = { bal: o.sqkBalance ?? 0n, allow: o.allowance ?? 0n, nonce: o.nonce ?? 0n, claimed: !!o.claimed, left: o.faucetLeft ?? 500n * 10n ** 18n, burned: 0n };
  const err = (code, message, data) => Object.assign(new Error(message), { code, data });
  const rv = (data) => (o.wrapReverts ? wrapped(data) : revert(data));     // o.wrapReverts: the wallet wraps every revert
  const eth = {
    calls, signed: [], sent: [], st,
    async request({ method, params }) {
      calls.push({ method, params });
      assert.ok(ALLOWED.has(method), `the page never asks the wallet for ${method}`);
      switch (method) {
        case 'eth_requestAccounts': if (o.noAccounts) throw err(4001, 'User rejected the request.'); return [me.toUpperCase().replace('0X', '0x')];
        case 'eth_accounts': return [me];
        case 'eth_chainId': return chain;
        case 'eth_getBalance': if (o.walletBalanceFails) throw new Error('not supported'); assert.equal(chain, '0xaa36a7', 'the balance is asked only on Sepolia'); return o.walletBalance || '0x56bc75e2d63100000';
        case 'eth_getBlockByNumber': if (o.noBlock) throw new Error('not supported'); return { number: '0x10', timestamp: '0x' + Math.floor((o.blockMs || NOW) / 1000).toString(16) };
        case 'wallet_switchEthereumChain':
          if (o.switchRejected) throw err(4001, 'User rejected the request.');
          if (o.unknownChain && !eth.added) throw err(4902, 'Unrecognized chain ID "0xaa36a7".');
          chain = params[0].chainId; return null;
        case 'wallet_addEthereumChain': eth.added = params[0]; chain = params[0].chainId; return null;
        case 'eth_call': {
          const { to, data: d, from } = params[0];
          assert.equal(chain, '0xaa36a7', 'eth_call through the wallet only on Sepolia');
          if (to === CONTRACT) {
            if (d.startsWith(QC.SEL.result)) { if (o.alreadyHas) return '0x' + [0, 20762, 3, 0, 0, 0, 3].map(pad).join(''); throw rv(QC.ERR.NonexistentToken + d.slice(10)); }
            if (d === QC.SEL.netCost) { if (o.netCostFails) throw new Error('Failed to fetch'); if (cost === null) throw rv('0x'); return '0x' + pad(cost); }
            if (d === QC.SEL.sqk) { if (cost === null) throw rv('0x'); return '0x' + pad(cost ? token : 0); }
            if (sel(d) === QC.SEL.castNetWithPermit) {                   // the simulation of the paid cast, from the caster
              assert.equal(from, me, 'simulated from the caster');
              if (o.simFails) throw new Error('Failed to fetch');
              if (o.simRevert) throw rv(o.simRevert);
              return '0x';
            }
            if (d === QC.SEL.castNet) {                                    // the simulation of a plain castNet(), from the caster
              assert.equal(from, me, 'simulated from the caster');
              if (o.castSimFails) throw new Error('Failed to fetch');
              if (o.castSimRevert) throw rv(o.castSimRevert);
              return '0x' + pad(QC.netId(o.chainNight || 20762, me));
            }
          }
          if (to === token) {
            if (sel(d) === QC.SEL.balanceOf) { assert.equal(d, QC.enc.balanceOf(me)); return '0x' + pad(st.bal); }
            if (sel(d) === QC.SEL.allowance) { assert.equal(d, QC.enc.allowance(me, CONTRACT), 'allowance(caster, the contract)'); return '0x' + pad(st.allow); }
            if (sel(d) === QC.SEL.nonces) { assert.equal(d, QC.enc.nonces(me)); return '0x' + pad(st.nonce); }
            if (d === QC.SEL.eip712Domain) { if (o.domain === 'name') throw rv('0x'); return o.domainRaw || DOMAIN_RAW; }
            if (d === QC.SEL.name) return strRet(o.tokenName || 'Squeek');
          }
          if (to === FAUCET) {
            if (sel(d) === QC.SEL.canClaim) { assert.equal(d, QC.enc.canClaim(me)); return '0x' + pad(st.claimed ? 0 : 1); }
            if (d === QC.SEL.remaining) return '0x' + pad(st.left);
            if (d === QC.SEL.drip) return '0x' + pad(DRIP);
            if (d === QC.SEL.token) return '0x' + pad(o.faucetToken || token);
            if (d === QC.SEL.claim) {                                      // the simulation of claim(), from the claimer
              assert.equal(from, me, 'simulated from the claimer');
              if (o.claimSimFails) throw new Error('Failed to fetch');
              if (o.claimSimRevert) throw rv(o.claimSimRevert);
              return '0x';
            }
          }
          throw new Error('unexpected eth_call ' + to + ' ' + sel(d));
        }
        case 'eth_signTypedData_v4': {
          if (o.sign === 'unsupported') throw err(4200, 'The requested method is not supported by this Ethereum provider.');
          if (o.sign === 'missing') throw err(-32601, 'The method "eth_signTypedData_v4" does not exist / is not available.');
          if (o.sign === 'reject') throw err(4001, 'User rejected the request.');
          if (o.sign === 'reject-worded') throw err(4001, 'User rejected: this request is not supported on this device.');
          assert.equal(params[0], me, 'signed by the connected account');
          assert.equal(typeof params[1], 'string', 'v4 takes the typed data as a JSON string');
          const td = JSON.parse(params[1]);
          eth.signed.push(td);
          if (o.signer) return o.signer.signTypedData(td.domain, { Permit: td.types.Permit }, td.message);
          return '0x' + '11'.repeat(32) + '22'.repeat(32) + (o.sigV || '1c');
        }
        case 'eth_sendTransaction': {
          if (o.sendError) throw o.sendError;
          const tx = params[0], hash = '0x' + ['ab', 'cd', 'ef', '12'][nsent++].repeat(32);
          eth.sent.push(tx); txs[hash] = tx; return hash;
        }
        case 'eth_getTransactionReceipt': {
          const h = params[0], tx = txs[h];
          assert.ok(tx, 'a receipt only for a sent transaction');
          polls[h] = (polls[h] || 0) + 1;
          if (polls[h] < 3) return null;
          if (o.failed) return { status: '0x0', logs: [] };
          if (tx.to === token) {                                         // approve(spender, amount)
            assert.equal(sel(tx.data), QC.SEL.approve);
            if (o.approveFails) return { status: '0x0', logs: [] };
            assert.equal(wordHex(tx.data, 0), '0x' + pad(CONTRACT)); st.allow = word(tx.data, 1);
            return { status: '0x1', logs: [] };
          }
          if (tx.to === FAUCET) {                                        // claim()
            assert.equal(tx.data, QC.SEL.claim);
            st.claimed = true; st.left -= DRIP; st.bal += DRIP;
            return { status: '0x1', logs: [{ address: FAUCET, topics: ['0x' + pad(9), '0x' + pad(me)], data: '0x' + pad(1) }, { address: FAUCET, topics: [QC.TOPIC_CLAIMED, '0x' + pad(me)], data: '0x' + pad(DRIP) }] };
          }
          const n = o.chainNight || 20762, id = QC.netId(n, me), logs = [{ address: CONTRACT, topics: ['0x' + pad(7), '0x0', '0x0'], data: '0x' }];
          if (cost) {                                                    // a paid net: the contract pulls the cost and burns it
            if (sel(tx.data) === QC.SEL.castNetWithPermit && !o.permitIgnored) st.allow = cost;
            if (st.allow < cost || st.bal < cost) return { status: '0x0', logs: [] };
            st.allow -= cost; st.bal -= cost; st.burned += cost; st.nonce += sel(tx.data) === QC.SEL.castNetWithPermit ? 1n : 0n;
            logs.push({ address: CONTRACT, topics: [QC.TOPIC_NETPAID, '0x' + pad(n), '0x' + pad(me)], data: '0x' + pad(cost) });
          }
          assert.ok(tx.data === QC.SEL.castNet || (sel(tx.data) === QC.SEL.castNetWithPermit && tx.data.length === 10 + 4 * 64), 'castNet() or castNetWithPermit(deadline, v, r, s): never a spot');
          logs.push({ address: CONTRACT.toUpperCase().replace('0X', '0x'), topics: [QC.TOPIC_NETCAST, '0x' + pad(n), '0x' + pad(me)], data: '0x' + id.slice(2) });
          return { status: '0x1', logs };
        }
      }
      throw new Error('unexpected ' + method);
    },
  };
  return eth;
}
const NOW = Date.parse('2026-11-05T17:30:00Z');
const fastOpts = (extra) => ({ now: () => NOW, sleep: () => Promise.resolve(), pollMs: 1, timeoutMs: 1e9, ...extra });
const count = (eth, m) => eth.calls.filter((c) => c.method === m).length;
const runSteps = async (eth, extra) => { const steps = []; const r = await QC.castNetNft(eth, CONTRACT, fastOpts({ onStep: (s) => steps.push(s), ...extra })); return { r, steps }; };

test('wallet: connect, add + switch to Sepolia, one castNet() transaction (no spot), token id and night from the NetCast log', async () => {
  const eth = mockWallet({ unknownChain: true }), steps = [];
  const r = await QC.castNetNft(eth, CONTRACT, fastOpts({ onStep: (s) => steps.push(s) }));
  assert.deepEqual(r, { txHash: '0x' + 'ab'.repeat(32), night: 20762, day: '2026-11-05', tokenId: QC.netId(20762, ADDR), catcher: ADDR }, 'no spot: the chip draws it once the night is posted');
  assert.equal(eth.added.chainId, '0xaa36a7'); assert.equal(eth.added.nativeCurrency.symbol, 'ETH'); assert.ok(eth.added.rpcUrls[0].startsWith('https://'));
  const sends = eth.calls.filter((c) => c.method === 'eth_sendTransaction');
  assert.equal(sends.length, 1, 'exactly one transaction');
  assert.deepEqual(sends[0].params[0], { from: ADDR, to: CONTRACT, data: QC.enc.castNet(), value: '0x0' });
  assert.deepEqual(steps, ['connect', 'network', 'check', 'send', 'wait', 'done']);
  // the chain's own night wins over the viewer's clock (a cast right at 21:00 UTC can land in the next night)
  const late = await QC.castNetNft(mockWallet({ chain: '0xaa36a7', chainNight: 20763 }), CONTRACT, fastOpts());
  assert.equal(late.night, 20763); assert.equal(late.day, '2026-11-06');
  // the "already cast?" check asks about the night of the chain's latest block (not the viewer's clock), else the viewer's clock
  const chk = mockWallet({ chain: '0xaa36a7', blockMs: Date.parse('2026-11-05T21:30:00Z') });
  await QC.castNetNft(chk, CONTRACT, fastOpts());
  assert.equal(chk.calls.find((c) => c.method === 'eth_call').params[0].data, QC.enc.result(QC.netId(20763, ADDR)), 'after 21:00 UTC chain time: the 6 Nov net');
  const nob = mockWallet({ chain: '0xaa36a7', noBlock: true });
  await QC.castNetNft(nob, CONTRACT, fastOpts());
  assert.equal(nob.calls.find((c) => c.method === 'eth_call').params[0].data, QC.enc.result(QC.netId(20762, ADDR)), 'no block: the viewer\'s clock (5 Nov)');
});

test('wallet: plain-word errors; nothing is sent when this wallet already has tonight\'s net', async () => {
  const say = async (o) => { try { await QC.castNetNft(mockWallet(o), CONTRACT, fastOpts()); return 'no error'; } catch (e) { return QC.plainError(e); } };
  const already = mockWallet({ chain: '0xaa36a7', alreadyHas: true });
  await assert.rejects(QC.castNetNft(already, CONTRACT, fastOpts()), (e) => e.code === 'already');
  assert.equal(already.calls.filter((c) => c.method === 'eth_sendTransaction').length, 0, 'no transaction when the net exists');
  assert.match(await say({ chain: '0xaa36a7', alreadyHas: true }), /already has a net/);
  assert.match(await say({ noAccounts: true }), /said no in your wallet\. Nothing was sent/);
  assert.match(await say({ switchRejected: true }), /Sepolia test network/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('User denied transaction signature.'), { code: 4001 }) }), /said no in your wallet\. Nothing was sent/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 }) }), /Sepolia test ETH/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('execution reverted'), { code: 3, data: QC.ERR.AlreadyCast + pad(20762) + pad(ADDR) }) }), /already has a net/);
  assert.match(await say({ chain: '0xaa36a7', sendError: { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { data: QC.ERR.AlreadyCast + pad(1) + pad(ADDR) } } } }), /already has a net/, 'nested error data (MetaMask style)');
  assert.match(await say({ chain: '0xaa36a7', failed: true }), /did not go through/);
  // the old call shape (a spot before the options) is refused before the wallet is asked anything
  const old = mockWallet({ chain: '0xaa36a7' });
  await assert.rejects(QC.castNetNft(old, CONTRACT, 6, fastOpts()), /no spot/);
  assert.equal(old.calls.length, 0);
  assert.match(QC.plainError(Object.assign(new Error('x'), { code: -32002 })), /already asking you something/);
  assert.match(QC.plainError(new Error('weird')), /Something went wrong/);
  assert.match(QC.plainError({ code: 'timeout' }), /may still arrive/);
  assert.match(QC.plainError({ code: 'nowallet' }), /No wallet found in this browser: casting a net needs a browser wallet on the Sepolia test network \(the page still works for watching\)/);
  assert.doesNotMatch(QC.plainError({ code: 'nowallet' }), /optional/, 'a net IS its NFT (R6\'): without a wallet the page is for watching');
});

test('wallet: no Sepolia test ETH stops before the network prompt (public RPC check), or before the send (the wallet\'s own check)', async () => {
  const say = (e) => QC.plainError(e);
  const a = mockWallet(), seen = [];
  await assert.rejects(QC.castNetNft(a, CONTRACT, fastOpts({ balance: async (who) => { seen.push(who); return 0n; } })), (e) => e.code === 'nofunds' && /no Sepolia test ETH.*faucet.*Nothing was sent/.test(say(e)));
  assert.deepEqual(a.calls.map((c) => c.method), ['eth_requestAccounts'], 'one prompt (connect), then the faucet line: no network switch, no transaction');
  assert.deepEqual(seen, [ADDR], 'the balance of the connected account');
  // the public RPC is blocked (null/throws): the wallet's own read-only eth_getBalance once it is on Sepolia
  for (const balance of [async () => { throw new Error('Failed to fetch'); }, undefined]) {
    const b = mockWallet({ unknownChain: true, walletBalance: '0x0' });
    await assert.rejects(QC.castNetNft(b, CONTRACT, fastOpts({ balance })), (e) => e.code === 'nofunds');
    assert.ok(!b.calls.some((c) => c.method === 'eth_sendTransaction'), 'nothing sent');
    assert.ok(b.calls.some((c) => c.method === 'eth_getBalance'));
  }
  // with funds (either check) the one transaction goes out; an unanswered check never blocks it
  for (const [balance, o] of [[async () => 10n ** 15n, {}], [async () => { throw new Error('x'); }, { walletBalanceFails: true }]]) {
    const c = mockWallet({ chain: '0xaa36a7', ...o });
    const r = await QC.castNetNft(c, CONTRACT, fastOpts({ balance }));
    assert.equal(r.night, 20762); assert.equal(c.calls.filter((x) => x.method === 'eth_sendTransaction').length, 1);
  }
});

// ---------- v2: a net costs 0.01 test SQK, burned (castNetWithPermit / castNet after an approve) ----------
test('v2 free nets (NET_COST() = 0): the plain path, one castNet(); the live v1 pick-a-spot contract (no NET_COST(), it reverts) is refused before anything is sent', async () => {
  for (const wrapReverts of [false, true]) {
    const eth = mockWallet({ chain: '0xaa36a7', netCost: 0n, wrapReverts });
    const { r, steps } = await runSteps(eth);
    assert.deepEqual(r, { txHash: '0x' + 'ab'.repeat(32), night: 20762, day: '2026-11-05', tokenId: QC.netId(20762, ADDR), catcher: ADDR });
    assert.deepEqual(steps, ['connect', 'network', 'check', 'send', 'wait', 'done'], 'the plain steps');
    assert.deepEqual(eth.calls.filter((c) => c.method === 'eth_call').map((c) => [c.params[0].to, c.params[0].data]), [[CONTRACT, QC.enc.result(QC.netId(20762, ADDR))], [CONTRACT, QC.enc.netCost()], [CONTRACT, QC.enc.castNet()]], 'no token reads; the cast simulated once');
    assert.deepEqual(eth.sent, [{ from: ADDR, to: CONTRACT, data: QC.enc.castNet(), value: '0x0' }]);
    assert.equal(count(eth, 'eth_signTypedData_v4'), 0, 'no signature');
    // the v1 contract takes castNet(uint8 spot): castNet() would only revert there, so nothing is signed or sent
    const v1 = mockWallet({ chain: '0xaa36a7', v1: true, wrapReverts }), seen = [];
    await assert.rejects(QC.castNetNft(v1, CONTRACT, fastOpts({ onStep: (x) => seen.push(x) })), (e) => e.code === 'config' && /do not match.*pick-a-spot.*Nothing was sent/.test(QC.plainError(e)));
    assert.deepEqual(seen, ['connect', 'network', 'check']);
    assert.equal(v1.sent.length + count(v1, 'eth_signTypedData_v4'), 0);
  }
  // NET_COST() unanswered (the network, not a revert) is not "free": it stops, nothing sent (castNet would fail unpaid)
  const nf = mockWallet({ chain: '0xaa36a7', netCost: CENT, netCostFails: true, sqkBalance: CENT });
  await assert.rejects(QC.castNetNft(nf, CONTRACT, fastOpts()), /Failed to fetch/);
  assert.equal(nf.sent.length, 0); assert.equal(count(nf, 'eth_signTypedData_v4'), 0);
  assert.equal(await QC.netCostOf(async () => { throw revert('0x'); }, CONTRACT), 0n, 'a revert: free');
  assert.equal(await QC.netCostOf(async () => { throw wrapped('0x'); }, CONTRACT), 0n, 'an empty revert wrapped by the wallet (v1 NET_COST() in a browser wallet): free');
  assert.equal(await QC.netCostOf(async () => { throw { code: -32603, message: 'Internal JSON-RPC error.', error: { message: 'execution reverted' } }; }, CONTRACT), 0n, 'wrapped under error');
  await assert.rejects(QC.netCostOf(async () => { throw { code: -32603, message: 'Internal JSON-RPC error.', data: { code: -32000, message: 'nonce too low' } }; }, CONTRACT), (e) => e.code === -32603, 'a wrapped non-revert is not free');
  await assert.rejects(QC.netCostOf(async () => { throw { code: -32603, message: 'Internal JSON-RPC error.' }; }, CONTRACT), (e) => e.code === -32603);
  assert.equal(await QC.netCostOf(async () => '0x' + pad(CENT), CONTRACT), CENT);
  await assert.rejects(QC.netCostOf(async () => '0x', CONTRACT), /no data/, 'no answer at all is not free either');
});

test('v2 permit path: ONE signature (eth_signTypedData_v4) + ONE transaction (castNetWithPermit); the domain from eip712Domain() = the real token\'s', async (ctx) => {
  const signer = ethers ? ethers.Wallet.createRandom() : null, who = signer ? signer.address.toLowerCase() : ADDR;
  const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: 10n * CENT, nonce: 3n, account: who, signer });
  const { r, steps } = await runSteps(eth, { sqk: SQK.toUpperCase().replace('0X', '0x') });
  assert.deepEqual(r, { txHash: '0x' + 'ab'.repeat(32), night: 20762, day: '2026-11-05', tokenId: QC.netId(20762, who), catcher: who }, 'the same return shape as a free net');
  assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'send', 'wait', 'done']);
  assert.equal(count(eth, 'eth_signTypedData_v4'), 1, 'one signature'); assert.equal(count(eth, 'eth_sendTransaction'), 1, 'one transaction');
  const order = eth.calls.map((c) => c.method).filter((m) => /^eth_(sign|send)|^wallet_/.test(m));
  assert.deepEqual(order, ['eth_signTypedData_v4', 'eth_sendTransaction'], 'already on Sepolia: the signature, then the one transaction');
  const td = eth.signed[0], deadline = BigInt(Math.floor(NOW / 1000) + QC.PERMIT_TTL);
  assert.equal(QC.PERMIT_TTL, 3600);
  assert.equal(td.primaryType, 'Permit');
  assert.deepEqual(td.domain, { name: 'Squeek', version: '1', chainId: 11155111, verifyingContract: SQK });
  assert.deepEqual(td.types, { EIP712Domain: DOMAIN_TYPES, Permit: PERMIT_TYPES });
  assert.deepEqual(td.message, { owner: who, spender: CONTRACT, value: '10000000000000000', nonce: '3', deadline: String(deadline) }, 'exactly the net\'s cost, to the contract, the token\'s nonce, chain time + 1 h');
  const tx = eth.sent[0];
  assert.deepEqual([tx.from, tx.to, tx.value, sel(tx.data), (tx.data.length - 10) / 64], [who, CONTRACT, '0x0', QC.SEL.castNetWithPermit, 4]);
  assert.equal(word(tx.data, 0), deadline, 'castNetWithPermit(deadline, v, r, s): no spot');
  const sim = eth.calls.find((c) => c.method === 'eth_call' && c.params[0].data === tx.data);
  assert.ok(sim && sim.params[0].from === who, 'simulated (eth_call from the caster) before the one transaction');
  assert.deepEqual([eth.st.bal, eth.st.burned, eth.st.allow], [9n * CENT, CENT, 0n], 'the mock chain: 0.01 burned, no allowance left');
  if (!ethers) { ctx.diagnostic('ethers not found (ETHERS_PATH): the signature recovery and the real domain hash are not cross-checked'); return; }
  assert.equal(ethers.TypedDataEncoder.hashDomain(td.domain), DOMAIN_HASH, 'the domain hashes to the real token\'s DOMAIN_SEPARATOR()');
  assert.deepEqual(td.types.EIP712Domain, ethers.TypedDataEncoder.getPayload(td.domain, { Permit: td.types.Permit }, td.message).types.EIP712Domain);
  const v = Number(word(tx.data, 1)), rr = wordHex(tx.data, 2), ss = wordHex(tx.data, 3);
  assert.equal(ethers.verifyTypedData(td.domain, { Permit: td.types.Permit }, td.message, { v, r: rr, s: ss }), signer.address, 'v, r, s go to the contract in its order and recover the caster');
});

test('v2 permit path: a token without eip712Domain() gets name() + version "1" + the chain id + the token (the same domain)', async (ctx) => {
  const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, domain: 'name', wrapReverts: true });   // (its revert wrapped by the wallet)
  const { steps } = await runSteps(eth);
  assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'send', 'wait', 'done']);
  assert.ok(eth.calls.some((c) => c.method === 'eth_call' && c.params[0].to === SQK && c.params[0].data === QC.SEL.name), 'name() asked');
  const td = eth.signed[0];
  assert.deepEqual(td.domain, { name: 'Squeek', version: '1', chainId: 11155111, verifyingContract: SQK });
  assert.deepEqual(td.types.EIP712Domain, DOMAIN_TYPES);
  // the mock's signature (r = 32 bytes of 11, s = 32 bytes of 22, v byte 1c): v 28, r, s straight into castNetWithPermit
  const tx = eth.sent[0];
  assert.deepEqual([Number(word(tx.data, 1)), wordHex(tx.data, 2), wordHex(tx.data, 3)], [28, '0x' + '11'.repeat(32), '0x' + '22'.repeat(32)]);
  if (ethers) assert.equal(ethers.TypedDataEncoder.hashDomain(td.domain), DOMAIN_HASH, 'name() + "1": the real DOMAIN_SEPARATOR() too');
  else ctx.diagnostic('ethers not found: the domain hash is not cross-checked');
});

test('v2: EIP-5267 domains (only the fields the token names; extensions = no permit, the approve path) and signatures (v 0/1, EIP-2098)', async () => {
  const call = (raw) => async (to, d) => (d === QC.SEL.eip712Domain ? raw : strRet('Other'));
  const d = QC.dec.eip712Domain(DOMAIN_RAW);
  assert.deepEqual(d, { fields: 15, name: 'Squeek', version: '1', chainId: 11155111n, verifyingContract: SQK, salt: '0x' + pad(0), extensions: 0 }, 'the real recorded answer');
  assert.equal(domainRet({ fields: 15, name: 'Squeek', version: '1', chainId: 11155111n, vc: SQK }), DOMAIN_RAW, 'the hand encoder = the real bytes');
  assert.deepEqual(await QC.tokenDomain(call(DOMAIN_RAW), SQK, 1), { fields: [['name', 'string'], ['version', 'string'], ['chainId', 'uint256'], ['verifyingContract', 'address']], domain: { name: 'Squeek', version: '1', chainId: 11155111, verifyingContract: SQK } }, 'the token\'s own chain id, not the argument');
  const noVer = await QC.tokenDomain(call(domainRet({ fields: 0x1d, name: 'X', chainId: 11155111n, vc: SQK, salt: 5n })), SQK, 11155111);
  assert.deepEqual(noVer.domain, { name: 'X', chainId: 11155111, verifyingContract: SQK, salt: '0x' + pad(5) }, 'no version field: none in the domain; a salt: in it');
  assert.deepEqual(QC.permitTypedData(noVer, ADDR, CONTRACT, CENT, 0n, 1n).types.EIP712Domain.map((x) => x.name), ['name', 'chainId', 'verifyingContract', 'salt']);
  assert.equal(await QC.tokenDomain(call(domainRet({ fields: 15, name: 'X', version: '1', chainId: 1n, vc: SQK, ext: [7] })), SQK, 1), null, 'extensions: no generic domain');
  assert.equal(await QC.tokenDomain(call(domainRet({ fields: 0x2f, name: 'X', version: '1', chainId: 1n, vc: SQK })), SQK, 1), null, 'an unknown field bit');
  await assert.rejects(QC.tokenDomain(async () => { throw new Error('Failed to fetch'); }, SQK, 1), /Failed to fetch/, 'the network is not "no domain"');
  // a token whose domain this code cannot build: no signature is asked, approve(exactly the cost) + castNet
  const ext = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, domainRaw: domainRet({ fields: 15, name: 'Squeek', version: '1', chainId: 11155111n, vc: SQK, ext: [1] }) });
  await runSteps(ext);
  assert.equal(count(ext, 'eth_signTypedData_v4'), 0);
  assert.deepEqual(ext.sent.map((t) => [t.to, t.data]), [[SQK, QC.enc.approve(CONTRACT, CENT)], [CONTRACT, QC.enc.castNet()]]);
  // signatures
  const r = '11'.repeat(32), s = '22'.repeat(32);
  assert.deepEqual(QC.splitSig('0x' + r + s + '1b'), { v: 27, r: '0x' + r, s: '0x' + s });
  assert.deepEqual(QC.splitSig('0x' + r + s + '00'), { v: 27, r: '0x' + r, s: '0x' + s }, 'v 0 = 27');
  assert.deepEqual(QC.splitSig('0x' + r + s + '01'), { v: 28, r: '0x' + r, s: '0x' + s }, 'v 1 = 28');
  assert.deepEqual(QC.splitSig('0x' + r + (BigInt('0x' + s) | (1n << 255n)).toString(16)), { v: 28, r: '0x' + r, s: '0x' + s }, 'EIP-2098 compact: the top bit of vs is the parity');
  assert.deepEqual(QC.splitSig('0x' + r + s), { v: 27, r: '0x' + r, s: '0x' + s });
  for (const bad of ['0x', '0x' + r, '0x' + r + s + '1d', '0x' + r + s + '1b00', 'nope']) assert.throws(() => QC.splitSig(bad), (e) => e.code === 'sig');
  assert.throws(() => QC.enc.castNetWithPermit(16, 1n, 27, '0x' + r, '0x' + s), /no spot/, 'the old shape with a spot is refused');
  assert.throws(() => QC.enc.castNetWithPermit(1n, 29, '0x' + r, '0x' + s), /v must be/);
  assert.throws(() => QC.enc.castNetWithPermit(1n, 27, '0x' + r.slice(2), '0x' + s), /32 bytes/);
  if (ethers) {
    const sig = ethers.Signature.from({ r: '0x' + r, s: '0x' + s, v: 28 });
    assert.deepEqual(QC.splitSig(sig.serialized), { v: 28, r: '0x' + r, s: '0x' + s }, 'ethers\' 65-byte form');
    assert.deepEqual(QC.splitSig(sig.compactSerialized), { v: 28, r: '0x' + r, s: '0x' + s }, 'ethers\' EIP-2098 form');
  }
});

test('v2: an allowance already in place: plain castNet, no signature; exactly enough test SQK is enough', async () => {
  const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, allowance: CENT });
  const { r, steps } = await runSteps(eth);
  assert.equal(r.tokenId, QC.netId(20762, ADDR));
  assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'send', 'wait', 'done']);
  assert.equal(count(eth, 'eth_signTypedData_v4'), 0);
  assert.deepEqual(eth.sent, [{ from: ADDR, to: CONTRACT, data: QC.enc.castNet(), value: '0x0' }]);
  assert.deepEqual([eth.st.bal, eth.st.burned], [0n, CENT]);
});

test('v2: a wallet that cannot sign typed data: approve(contract, exactly 0.01) then castNet, reported as sqk-approve; a failed approve sends nothing more', async () => {
  for (const sign of ['unsupported', 'missing']) {
    const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: 5n * CENT, sign });
    const { r, steps } = await runSteps(eth);
    assert.equal(r.night, 20762); assert.equal(r.txHash, '0x' + 'cd'.repeat(32), 'the cast is the second transaction');
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'sqk-approve', 'send', 'wait', 'done'], sign);
    assert.deepEqual(eth.sent, [{ from: ADDR, to: SQK, data: QC.enc.approve(CONTRACT, CENT), value: '0x0' }, { from: ADDR, to: CONTRACT, data: QC.enc.castNet(), value: '0x0' }]);
    assert.equal(word(eth.sent[0].data, 1), CENT, 'never an unlimited approval: exactly the net\'s cost');
    const i = eth.calls.findIndex((c) => c.method === 'eth_sendTransaction'), j = eth.calls.findIndex((c, k) => k > i && c.method === 'eth_getTransactionReceipt' && c.params[0] === '0x' + 'ab'.repeat(32));
    assert.ok(j > i && eth.calls.slice(j).some((c) => c.method === 'eth_sendTransaction'), 'the cast goes out after the approve\'s receipt');
    assert.deepEqual([eth.st.bal, eth.st.burned, eth.st.allow], [4n * CENT, CENT, 0n]);
  }
  const bad = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, sign: 'missing', approveFails: true });
  await assert.rejects(QC.castNetNft(bad, CONTRACT, fastOpts()), (e) => e.code === 'failed' && e.what === 'approve' && /did not go through/.test(QC.plainError(e)));
  assert.equal(bad.sent.length, 1, 'no cast after a failed approve');
  const slow = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, sign: 'missing' });
  let t = NOW;
  await assert.rejects(QC.castNetNft(slow, CONTRACT, { now: () => (t += 1000), sleep: async () => {}, pollMs: 1, timeoutMs: 1500 }), (e) => e.code === 'timeout' && e.what === 'approve' && /approval may still go through/.test(QC.plainError(e)));
  assert.equal(slow.sent.length, 1);
});

test('v2: no to the signature is a no (nothing sent, never an approve instead); too little test SQK stops before any prompt (NO_SQK, the faucet)', async () => {
  for (const sign of ['reject', 'reject-worded']) {                  // 4001 is a no, whatever words come with it
    const no = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, sign });
    await assert.rejects(QC.castNetNft(no, CONTRACT, fastOpts()), (e) => e.code === 4001 && /said no in your wallet\. Nothing was sent/.test(QC.plainError(e)));
    assert.equal(no.sent.length, 0, 'no transaction, no approve fallback');
  }
  for (const sqkBalance of [0n, CENT - 1n]) {
    const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance }), steps = [];
    let err = null;
    await QC.castNetNft(eth, CONTRACT, fastOpts({ onStep: (s) => steps.push(s) })).catch((e) => { err = e; });
    assert.ok(err && err.code === 'NO_SQK', 'code NO_SQK');
    assert.deepEqual([err.cost, err.balance, err.sqk], [CENT, sqkBalance, SQK], 'the cost, the balance and the token on the error');
    assert.match(QC.plainError(err), /costs 0\.01 test SQK \(it gets burned\).*faucet.*Nothing was sent/);
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check']);
    assert.equal(count(eth, 'eth_signTypedData_v4') + count(eth, 'eth_sendTransaction'), 0, 'no signature, no transaction');
  }
  assert.match(QC.plainError({ code: 'NO_SQK' }), /a little test SQK/);
  assert.match(QC.plainError(revert(QC.ERR.InsufficientBalance + pad(ADDR) + pad(0) + pad(CENT))), /test SQK.*faucet/, 'the token\'s own balance revert');
  assert.match(QC.plainError(revert(QC.ERR.InsufficientAllowance + pad(CONTRACT) + pad(0) + pad(CENT))), /not approved, so nothing was sent/);
  // the page's expected token (opts.sqk) differs from the contract's SQK(): stop before any signature
  const other = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT });
  await assert.rejects(QC.castNetNft(other, CONTRACT, fastOpts({ sqk: ADDR })), (e) => e.code === 'config' && /do not match/.test(QC.plainError(e)));
  assert.equal(count(other, 'eth_signTypedData_v4') + count(other, 'eth_sendTransaction'), 0);
  // already cast tonight: said before any token read
  const al = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: 0n, alreadyHas: true });
  await assert.rejects(QC.castNetNft(al, CONTRACT, fastOpts()), (e) => e.code === 'already');
  assert.ok(!al.calls.some((c) => c.method === 'eth_call' && c.params[0].to === SQK));
});

test('v2: the permit cast is simulated first: a token that ignored the permit = the approve path; already cast = nothing sent; an unanswered simulation goes on', async () => {
  const allowRev = QC.ERR.InsufficientAllowance + pad(CONTRACT) + pad(0) + pad(CENT);
  for (const wrapReverts of [false, true]) {
    const ign = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, simRevert: allowRev, permitIgnored: true, wrapReverts });
    const { steps } = await runSteps(ign);
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'sqk-approve', 'send', 'wait', 'done']);
    assert.equal(count(ign, 'eth_signTypedData_v4'), 1);
    assert.deepEqual(ign.sent.map((t) => [t.to, t.data]), [[SQK, QC.enc.approve(CONTRACT, CENT)], [CONTRACT, QC.enc.castNet()]], 'castNet, not the dead permit');
    const al = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, simRevert: QC.ERR.AlreadyCast + pad(20762) + pad(ADDR), wrapReverts });
    await assert.rejects(QC.castNetNft(al, CONTRACT, fastOpts()), (e) => e.code === 'already');
    assert.equal(al.sent.length, 0);
  }
  const odd = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, simRevert: '0xdeadbeef' });
  await assert.rejects(QC.castNetNft(odd, CONTRACT, fastOpts()), (e) => QC.isRevert(e) && /Something went wrong/.test(QC.plainError(e)));
  assert.equal(odd.sent.length, 0, 'an unknown revert: nothing sent');
  const bal = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, simRevert: QC.ERR.InsufficientBalance + pad(ADDR) + pad(0) + pad(CENT) });
  await assert.rejects(QC.castNetNft(bal, CONTRACT, fastOpts()), (e) => e.code === 'NO_SQK');
  const off = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, simFails: true });
  await runSteps(off);
  assert.deepEqual(off.sent.map((t) => sel(t.data)), [QC.SEL.castNetWithPermit], 'the simulation did not answer: the one transaction still goes out');
});

test('sqkInfo: the cost, the token, the wallet\'s test SQK and the faucet, read-only, through a call function or the wallet', async () => {
  const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: 3n * CENT, faucetLeft: 42n * DRIP });
  const want = { cost: CENT, sqk: SQK, balance: 3n * CENT, faucetLeft: 42n * DRIP, drip: DRIP, claimed: false };
  assert.deepEqual(await QC.sqkInfo(eth, CONTRACT, FAUCET, ADDR), want, 'through the wallet (EIP-1193)');
  assert.deepEqual(await QC.sqkInfo(QC.walletCall(eth), CONTRACT, FAUCET, ADDR.toUpperCase().replace('0X', '0x')), want, 'through a call(to, data) function (QC.rpcCall)');
  assert.ok(eth.calls.every((c) => c.method === 'eth_call' || c.method === 'eth_chainId'), 'read-only: eth_call (and the chain id) only');
  const off = mockWallet({ chain: '0x1', netCost: CENT });
  await assert.rejects(QC.sqkInfo(off, CONTRACT, FAUCET, ADDR), (e) => e.code === 'chain', 'a wallet on another network: no numbers from there');
  assert.deepEqual(off.calls.map((c) => c.method), ['eth_chainId']);
  assert.deepEqual(await QC.sqkInfo(eth, CONTRACT, null, null), { cost: CENT, sqk: SQK, balance: null, faucetLeft: null, drip: null, claimed: null }, 'no faucet, no wallet yet');
  assert.deepEqual(await QC.sqkInfo(eth, CONTRACT, FAUCET, null), { ...want, balance: null, claimed: null });
  assert.deepEqual(await QC.sqkInfo(mockWallet({ chain: '0xaa36a7', v1: true }), CONTRACT, null, ADDR), { cost: 0n, sqk: null, balance: null, faucetLeft: null, drip: null, claimed: null }, 'the live v1 contract: free nets (read-only)');
  assert.deepEqual(await QC.sqkInfo(mockWallet({ chain: '0xaa36a7', netCost: 0n }), CONTRACT, null, ADDR), { cost: 0n, sqk: null, balance: null, faucetLeft: null, drip: null, claimed: null }, 'v2 without SQK: free nets');
  await assert.rejects(QC.sqkInfo(mockWallet({ chain: '0xaa36a7', netCost: CENT, faucetToken: ADDR }), CONTRACT, FAUCET, ADDR), (e) => e.code === 'config', 'a faucet for another token');
  await assert.rejects(QC.sqkInfo(mockWallet({ chain: '0xaa36a7', netCost: CENT, netCostFails: true }), CONTRACT, FAUCET, ADDR), /Failed to fetch/);
  const claimed = mockWallet({ chain: '0xaa36a7', netCost: CENT, claimed: true });
  assert.equal((await QC.sqkInfo(claimed, CONTRACT, FAUCET, ADDR)).claimed, true, 'claimed = canClaim() is false: already claimed this net night');
  assert.ok(claimed.calls.some((c) => c.method === 'eth_call' && c.params[0].to === FAUCET && c.params[0].data === QC.enc.canClaim(ADDR)));
  assert.deepEqual([QC.units(CENT), QC.units(10n ** 17n), QC.units(0n), QC.units(564n * 10n ** 18n), QC.units(1n), QC.units(-CENT), QC.units(1234n, 2)], ['0.01', '0.1', '0', '564', '0.000000000000000001', '-0.01', '12.34']);
});

test('v2: every cast is simulated right before it is sent: a burned net (result() cannot see it) = AlreadyCast = nothing sent, free or with an allowance in place; an unanswered simulation goes on', async () => {
  const already = QC.ERR.AlreadyCast + pad(20762) + pad(ADDR);
  for (const wrapReverts of [false, true]) {
    for (const o of [{ netCost: 0n }, { netCost: CENT, sqkBalance: CENT, allowance: CENT }]) {
      const eth = mockWallet({ chain: '0xaa36a7', castSimRevert: already, wrapReverts, ...o }), steps = [];
      await assert.rejects(QC.castNetNft(eth, CONTRACT, fastOpts({ onStep: (x) => steps.push(x) })), (e) => e.code === 'already' && /already has a net/.test(QC.plainError(e)));
      assert.equal(eth.sent.length + count(eth, 'eth_signTypedData_v4'), 0, `nothing signed or sent (cost ${o.netCost})`);
      assert.ok(!steps.includes('send'));
      const sim = eth.calls.find((c) => c.method === 'eth_call' && c.params[0].data === QC.enc.castNet());
      assert.ok(sim && sim.params[0].from === ADDR && sim.params[0].to === CONTRACT, 'castNet() simulated from the caster');
    }
  }
  // not enough test SQK by the time of the cast: NO_SQK, nothing sent; an unknown revert: its own words, nothing sent
  const nb = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, allowance: CENT, castSimRevert: QC.ERR.InsufficientBalance + pad(ADDR) + pad(0) + pad(CENT) });
  await assert.rejects(QC.castNetNft(nb, CONTRACT, fastOpts()), (e) => e.code === 'NO_SQK');
  assert.equal(nb.sent.length, 0);
  const odd = mockWallet({ chain: '0xaa36a7', netCost: 0n, castSimRevert: '0xdeadbeef' });
  await assert.rejects(QC.castNetNft(odd, CONTRACT, fastOpts()), (e) => QC.isRevert(e) && /Nothing was taken/.test(QC.plainError(e)));
  assert.equal(odd.sent.length, 0);
  // right after our own approve a node may not see the allowance yet: an allowance revert lets the cast go out
  const lag = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT, sign: 'unsupported', castSimRevert: QC.ERR.InsufficientAllowance + pad(CONTRACT) + pad(0) + pad(CENT) });
  assert.equal((await QC.castNetNft(lag, CONTRACT, fastOpts())).night, 20762);
  assert.deepEqual(lag.sent.map((t) => t.data), [QC.enc.approve(CONTRACT, CENT), QC.enc.castNet()]);
  // the simulation does not answer (a wallet without eth_call from, the network): the one transaction still goes out
  const off = mockWallet({ chain: '0xaa36a7', netCost: 0n, castSimFails: true });
  assert.equal((await QC.castNetNft(off, CONTRACT, fastOpts())).night, 20762);
  assert.equal(off.sent.length, 1);
  // the permit path keeps its own simulation (of castNetWithPermit): no second one of castNet()
  const pm = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT });
  await QC.castNetNft(pm, CONTRACT, fastOpts());
  assert.ok(!pm.calls.some((c) => c.method === 'eth_call' && c.params[0].data === QC.enc.castNet()));
});

test('v2: opts.netCost (what the page expects a net to cost, in wei) must be the contract\'s NET_COST(), else nothing is signed or sent', async () => {
  const eth = mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT });
  await assert.rejects(QC.castNetNft(eth, CONTRACT, fastOpts({ netCost: CENT / 10n })), (e) => e.code === 'config' && /do not match/.test(QC.plainError(e)));
  assert.equal(eth.sent.length + count(eth, 'eth_signTypedData_v4'), 0);
  for (const nc of [CENT, String(CENT)]) assert.equal((await QC.castNetNft(mockWallet({ chain: '0xaa36a7', netCost: CENT, sqkBalance: CENT }), CONTRACT, fastOpts({ netCost: nc }))).night, 20762);
  await assert.rejects(QC.castNetNft(mockWallet({ chain: '0xaa36a7', netCost: 0n }), CONTRACT, fastOpts({ netCost: CENT })), (e) => e.code === 'config', 'a free contract is not what a paid page expects');
});

test('faucet: claim() is simulated right before it is sent: claimed tonight / empty by then = nothing sent; an unanswered simulation goes on', async () => {
  for (const wrapReverts of [false, true]) {
    const c = mockWallet({ chain: '0xaa36a7', claimSimRevert: QC.ERR.AlreadyClaimedTonight + pad(20762), wrapReverts });
    await assert.rejects(QC.claimFaucet(c, FAUCET, fastOpts()), (e) => e.code === 'claimed');
    assert.equal(c.sent.length, 0);
    const e2 = mockWallet({ chain: '0xaa36a7', claimSimRevert: QC.ERR.FaucetEmpty, wrapReverts });
    await assert.rejects(QC.claimFaucet(e2, FAUCET, fastOpts()), (e) => e.code === 'empty');
    assert.equal(e2.sent.length, 0);
  }
  const odd = mockWallet({ chain: '0xaa36a7', claimSimRevert: '0xdeadbeef' });
  await assert.rejects(QC.claimFaucet(odd, FAUCET, fastOpts()), (e) => QC.isRevert(e));
  assert.equal(odd.sent.length, 0);
  const off = mockWallet({ chain: '0xaa36a7', claimSimFails: true });
  assert.equal((await QC.claimFaucet(off, FAUCET, fastOpts())).amount, DRIP);
  const sim = off.calls.find((x) => x.method === 'eth_call' && x.params[0].data === QC.SEL.claim);
  assert.ok(sim && sim.params[0].from === ADDR && sim.params[0].to === FAUCET, 'claim() simulated from the claimer');
});

test('faucet: ONE claim() transaction, the amount from the Claimed log; already claimed this night (canClaim false) / empty / no test ETH send nothing', async () => {
  const eth = mockWallet({ unknownChain: true }), steps = [];
  const r = await QC.claimFaucet(eth, FAUCET.toUpperCase().replace('0X', '0x'), fastOpts({ onStep: (s) => steps.push(s) }));
  assert.deepEqual(r, { txHash: '0x' + 'ab'.repeat(32), to: ADDR, amount: DRIP });
  assert.deepEqual(steps, ['connect', 'network', 'faucet', 'wait', 'done']);
  assert.deepEqual(eth.sent, [{ from: ADDR, to: FAUCET, data: QC.SEL.claim, value: '0x0' }]);
  assert.equal(eth.added.chainId, '0xaa36a7', 'added + switched to Sepolia first');
  assert.equal(count(eth, 'eth_signTypedData_v4'), 0);
  const again = await QC.claimFaucet(eth, FAUCET, fastOpts()).catch((e) => e);
  assert.equal(again.code, 'claimed'); assert.match(QC.plainError(again), /already got today's free test SQK.*one claim per wallet per night.*21:00 UTC/);
  assert.equal(eth.sent.length, 1, 'the second claim sends nothing');
  const empty = mockWallet({ chain: '0xaa36a7', faucetLeft: DRIP - 1n });
  await assert.rejects(QC.claimFaucet(empty, FAUCET, fastOpts()), (e) => e.code === 'empty' && /faucet is empty/.test(QC.plainError(e)));
  assert.equal(empty.sent.length, 0);
  const broke = mockWallet();
  await assert.rejects(QC.claimFaucet(broke, FAUCET, fastOpts({ balance: async () => 0n })), (e) => e.code === 'nofunds');
  assert.deepEqual(broke.calls.map((c) => c.method), ['eth_requestAccounts'], 'no network prompt, no transaction');
  const failed = mockWallet({ chain: '0xaa36a7', failed: true });
  await assert.rejects(QC.claimFaucet(failed, FAUCET, fastOpts()), (e) => e.code === 'failed' && e.what === 'faucet');
  let t = NOW;
  await assert.rejects(QC.claimFaucet(mockWallet({ chain: '0xaa36a7' }), FAUCET, { now: () => (t += 1000), sleep: async () => {}, pollMs: 1, timeoutMs: 1500 }), (e) => e.code === 'timeout' && /test SQK may still arrive/.test(QC.plainError(e)));
  assert.match(QC.plainError(revert(QC.ERR.AlreadyClaimedTonight + pad(20762))), /already got today's free test SQK/, 'the contract\'s own revert');
  assert.match(QC.plainError(revert(QC.ERR.FaucetEmpty)), /faucet is empty/);
  assert.match(await QC.claimFaucet(mockWallet({ chain: '0xaa36a7', sendError: Object.assign(new Error('User denied transaction signature.'), { code: 4001 }) }), FAUCET, fastOpts()).catch((e) => QC.plainError(e)), /said no/);
  assert.equal(QC.dec.claimedLog({ topics: [QC.TOPIC_NETCAST, '0x' + pad(ADDR)], data: '0x' + pad(1) }), null, 'other events are not a Claimed');
});

test('v2 selectors, topics and errors: keccak of the signatures (ethers), and the forge build once it has the v2 contracts', () => {
  const fns = { castNet: 'castNet()', castNetWithPermit: 'castNetWithPermit(uint256,uint8,bytes32,bytes32)', netCost: 'NET_COST()', sqk: 'SQK()', balanceOf: 'balanceOf(address)', allowance: 'allowance(address,address)',
    approve: 'approve(address,uint256)', nonces: 'nonces(address)', eip712Domain: 'eip712Domain()', name: 'name()', claim: 'claim()', canClaim: 'canClaim(address)', remaining: 'remaining()', drip: 'DRIP()', token: 'TOKEN()' };
  const errs = { AlreadyClaimedTonight: 'AlreadyClaimedTonight(uint32)', FaucetEmpty: 'FaucetEmpty()', InsufficientBalance: 'ERC20InsufficientBalance(address,uint256,uint256)', InsufficientAllowance: 'ERC20InsufficientAllowance(address,uint256,uint256)' };
  assert.equal(QC.enc.castNetWithPermit(99n, 27, '0x' + '11'.repeat(32), '0x' + '22'.repeat(32)), QC.SEL.castNetWithPermit + pad(99) + pad(27) + '11'.repeat(32) + '22'.repeat(32));
  assert.equal(QC.enc.approve(CONTRACT, CENT), QC.SEL.approve + pad(CONTRACT) + pad(CENT));
  assert.equal(QC.enc.allowance(ADDR, CONTRACT), QC.SEL.allowance + pad(ADDR) + pad(CONTRACT));
  const id = new Map([[QC.TOPIC_NETPAID, 'NetPaid(uint32,address,uint256)'], [QC.TOPIC_CLAIMED, 'Claimed(address,uint256)']]);
  assert.deepEqual(QC.dec.netPaid({ topics: [QC.TOPIC_NETPAID, '0x' + pad(20762), '0x' + pad(ADDR)], data: '0x' + pad(CENT) }), { night: 20762, catcher: ADDR, burned: CENT });
  if (ethers) {
    for (const [k, s] of Object.entries(fns)) assert.equal(QC.SEL[k], ethers.id(s).slice(0, 10), s);
    for (const [k, s] of Object.entries(errs)) assert.equal(QC.ERR[k], ethers.id(s).slice(0, 10), s);
    for (const [t, s] of id) assert.equal(t, ethers.id(s), s);
  }
  const art = (name) => { const f = path.join(ROOT, `contracts/out/${name}.sol/${name}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
  const abiSig = (a) => `${a.name}(${a.inputs.map((x) => x.type).join(',')})`;
  const qc = art('QuantumCatch');
  if (qc && qc.methodIdentifiers['NET_COST()']) {                    // the v2 build: every v2 function the page calls is in it
    for (const k of ['castNet', 'castNetWithPermit', 'netCost', 'sqk']) assert.equal(QC.SEL[k], '0x' + qc.methodIdentifiers[fns[k]], `QuantumCatch ${fns[k]}`);
    const ev = qc.abi.filter((a) => a.type === 'event').map(abiSig);
    assert.ok(ev.includes('NetPaid(uint32,address,uint256)') && ev.includes('NetCast(uint32,address,uint256)'), ev.join(' '));
    const ab = qc.abi.map((a) => a.type + ' ' + (a.name ? abiSig(a) : ''));
    for (const s of ['error AlreadyCast(uint32,address)', 'error NonexistentToken(uint256)']) assert.ok(ab.includes(s), `QuantumCatch has ${s}`);
    assert.equal(QC.ERR.AlreadyCast, '0x' + (ethers ? ethers.id('AlreadyCast(uint32,address)').slice(2, 10) : QC.ERR.AlreadyCast.slice(2)));
    assert.equal(qc.methodIdentifiers['NO_SPOT()'] !== undefined, true, 'NO_SPOT() = 255: result().spot before the draw');
  }
  const fa = art('SqkFaucet');
  if (fa) {
    for (const k of ['claim', 'canClaim', 'remaining', 'drip', 'token']) assert.equal(QC.SEL[k], '0x' + fa.methodIdentifiers[fns[k]], `SqkFaucet ${fns[k]}`);
    const ab = fa.abi.filter((a) => a.name).map((a) => a.type + ' ' + abiSig(a));
    for (const s of ['error AlreadyClaimedTonight(uint32)', 'error FaucetEmpty()', 'event Claimed(address,uint256)']) assert.ok(ab.includes(s), `SqkFaucet has ${s}: ${ab.join(', ')}`);
  }
});

test('read-only rpc balance: eth_getBalance through the public endpoint, nothing else but eth_call', async () => {
  let body = null;
  const bal = QC.rpcBalance(async (url, init) => { body = JSON.parse(init.body); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x2386f26fc10000' }) }; }, 'https://ethereum-sepolia-rpc.publicnode.com');
  assert.equal(await bal(ADDR.toUpperCase().replace('0X', '0x')), 10n ** 16n);
  assert.deepEqual([body.method, body.params], ['eth_getBalance', [ADDR, 'latest']]);
});

test('my nets: result(tokenId) for recent nights through eth_call; nights without a net are skipped; images only from on-chain SVG', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  const uri = 'data:application/json;base64,' + Buffer.from(JSON.stringify({ name: 'n', attributes: [], image: 'data:image/svg+xml;base64,' + svg })).toString('base64');
  const enc = (s) => '0x' + pad(32) + pad(Buffer.byteLength(s)) + Buffer.from(s).toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
  const have = { [QC.netId(20762, ADDR)]: [0, 20762, 255, 0, 0, 0, 0], [QC.netId(20761, ADDR)]: [1, 20761, 15, 808, 4000, 1, 15], [QC.netId(20759, ADDR)]: [2, 20759, 0, 12, 4000, 0, 0] };
  const seen = [];
  const call = async (to, data) => {
    assert.equal(to, CONTRACT); seen.push(data.slice(0, 10));
    const id = '0x' + data.slice(10);
    if (!have[id]) throw Object.assign(new Error('execution reverted'), { code: 3, data: QC.ERR.NonexistentToken + data.slice(10) });
    return data.startsWith(QC.SEL.result) ? '0x' + have[id].map(pad).join('') : enc(uri);
  };
  const nets = await QC.myNets(call, CONTRACT, ADDR, [20762, 20761, 20760, 20759]);
  assert.deepEqual(nets.map((x) => [x.night, x.status, x.spot, x.tier]), [[20762, 0, null, 0], [20761, 1, 15, 1], [20759, 2, 0, 0]], 'the drawn spot + tier once posted, no spot before');
  assert.equal(nets[1].tokenId, QC.netId(20761, ADDR));
  assert.equal(nets[1].image, 'data:image/svg+xml;base64,' + svg);
  assert.equal(seen.filter((s) => s === QC.SEL.tokenURI).length, 3);
  assert.deepEqual(await QC.readNet(call, CONTRACT, QC.netId(20761, ADDR)), { status: 1, night: 20761, spot: 15, hits: 808, shots: 4000, tier: 1, looks: 15 }, 'readNet: the drawn spot and tier');
  assert.equal(await QC.readNet(call, CONTRACT, QC.netId(20760, ADDR)), null, 'no net (or a burned one): null');
  await assert.rejects(QC.myNets(async () => { throw new Error('Failed to fetch'); }, CONTRACT, ADDR, [20762]), /Failed to fetch/, 'a network error is not "no net"');
});

// ---------- SqueekCore live: tonight so far (a real recorded Sepolia response, 4 Nov night) ----------
const fixCall = async (to, data) => { assert.equal(to, FIX.core); const r = FIX.calls[data]; if (!r) throw new Error('not recorded: ' + data.slice(0, 10)); return r; };

test('SqueekCore decoding: state() settled round and roundPage() records (real Sepolia bytes)', () => {
  assert.equal(QC.dec.state(FIX.calls['0xc19d93fb']).settled, 273);
  const pg = QC.dec.roundPage(FIX.calls[QC.enc.roundPage(97, 241, 16)]);
  assert.equal(pg.through, 241);
  const want = CHAIN['2026-11-04'].rounds;
  assert.deepEqual(pg.rounds.map((r) => r.id), want.map((r) => r.id));
  let prev = pg.startWork; const turns = pg.rounds.map((r) => { const t = r.work - prev; prev = r.work; return t; });
  assert.deepEqual(turns, want.map((r) => r.turns));
  const p2 = QC.dec.roundPage(FIX.calls[QC.enc.roundPage(201, 241, 16)]);
  assert.deepEqual(p2.rounds.map((r) => r.id), [202, 203, 204, 205, 209, 210]);
  if (ethers) {
    const T = 'tuple(uint64 certifiedThroughRound, tuple(uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, tuple(uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, tuple(uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds)';
    const [e] = ethers.AbiCoder.defaultAbiCoder().decode([T], FIX.calls[QC.enc.roundPage(97, 241, 16)]);
    assert.equal(pg.startWork, Number(e.start.cumulativeWork)); assert.equal(pg.endWork, Number(e.end.cumulativeWork));
    assert.deepEqual(pg.rounds.map((r) => [r.id, r.work]), e.rounds.map((r) => [Number(r.roundId), Number(r.cumulativeWork)]));
  }
});

test('tonight so far: settled rounds of the running night only (his real 4 Nov night: 14 rounds, 3,817 turns)', async () => {
  const now = Date.parse('2026-11-05T11:00:00Z') / 1000;                 // the 4 Nov night runs until 12:00 UTC on 5 Nov
  const t = await QC.tonightSoFar(fixCall, FIX.core, FIX.genesis, now);
  assert.equal(t.day, '2026-11-04'); assert.equal(t.rounds, 14); assert.equal(t.turns, 3817);
  assert.equal(t.through, 241); assert.equal(t.complete, true, 'every round of the night is settled');
  assert.equal(t.upToMs, (FIX.genesis + 241 * 600) * 1000);
  // rounds after the settled round are unknown, never zero: with settled = 200 only rounds up to 200 are asked for
  const asked = [];
  const partial = async (to, data) => {
    asked.push(data);
    if (data === QC.enc.state()) return '0x' + [200, 0, 0, 0, 0, 0, 0, 0].map(pad).join('');
    if (data === QC.enc.roundPage(97, 200, 16)) {                         // the real records up to round 200, re-encoded by hand
      const recs = CHAIN['2026-11-04'].rounds.filter((r) => r.id <= 200); let w = 1000; const words = [];
      for (const r of recs) { w += r.turns; words.push(pad(r.id), pad(w), pad(0), pad(0), pad(0)); }
      return '0x' + [pad(32), pad(200), pad(1000), pad(0), pad(0), pad(w), pad(0), pad(0), pad(8 * 32), pad(recs.length)].join('') + words.join('');
    }
    throw new Error('unexpected ' + data.slice(0, 10));
  };
  const p = await QC.tonightSoFar(partial, FIX.core, FIX.genesis, now);
  assert.deepEqual(asked, [QC.enc.state(), QC.enc.roundPage(97, 200, 16)]);
  assert.equal(p.rounds, 7); assert.equal(p.turns, 6 + 250 + 471 + 500 + 178 + 452 + 136); assert.equal(p.complete, false);
  assert.equal(p.upToMs, (FIX.genesis + 200 * 600) * 1000);
  // before his first round of the night is settled: zero known rounds, nothing asked beyond state()
  const none = await QC.tonightSoFar(async (to, d) => { if (d === QC.enc.state()) return '0x' + [90, 0, 0, 0, 0, 0, 0, 0].map(pad).join(''); throw new Error('no'); }, FIX.core, FIX.genesis, now);
  assert.equal(none.rounds, 0); assert.equal(none.turns, 0); assert.equal(none.complete, false);
});

test('rpc call: a plain JSON-RPC eth_call POST; errors come back as errors', async () => {
  let body = null;
  const call = QC.rpcCall(async (url, init) => { body = JSON.parse(init.body); assert.equal(url, 'https://ethereum-sepolia-rpc.publicnode.com'); assert.equal(init.method, 'POST'); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: '0x01' }) }; }, 'https://ethereum-sepolia-rpc.publicnode.com');
  assert.equal(await call(FIX.core, '0xc19d93fb'), '0x01');
  assert.deepEqual(body.params, [{ to: FIX.core, data: '0xc19d93fb' }, 'latest']); assert.equal(body.method, 'eth_call');
  const bad = QC.rpcCall(async () => ({ ok: true, json: async () => ({ error: { code: 3, message: 'execution reverted', data: '0x2f4163e7' } }) }), 'https://x.invalid');
  await assert.rejects(bad(FIX.core, '0x00'), (e) => e.code === 3 && /revert/.test(e.message));
});

// the page build and this (v2) catch.js against the live v1 contract: catch.js refuses v1 ('config'), so a page without a
// guard would ship a dead NFT button and is refused. The page v2 template has the guard (const NOT_WIRED: it reads NET_COST()
// and says "Casting opens soon" instead of a button, RULINGS 52/58), so it builds, with a note. The switch is one step:
// catchAddress to the v2 deploy, or null (watch-only).
// Season 1 test builds (--season2-address null): since the 7 Nov switch wheel/config.json names the Season 2 contract
test('build.py: v2 catch.js with the v1 catchAddress: refused without the not-wired guard (nothing written); this page has it; null (watch-only) builds', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'qc-build-')), out = path.join(dir, 'p.html'), V1 = '0xa0B3352b3a436c845E3BF2D251ABeda3D474Dfe0';
  // build.py with the template read through a filter (here: the guard taken out)
  const noGuard = ['-c', ['import builtins, io, runpy, sys', 'real = builtins.open',
    'def fake(p, *a, **k):',
    "    if str(p).endswith('page.template.html') and not (a and 'w' in a[0]):",
    "        return io.StringIO(real(p, *a, **k).read().replace('const NOT_WIRED = ', 'const NOT_WIRED_GONE = '))",
    '    return real(p, *a, **k)',
    'builtins.open = fake', 'sys.argv = sys.argv[1:]', 'runpy.run_path(sys.argv[0], run_name="__main__")'].join('\n'), path.join(ROOT, 'wheel/build.py')];
  try {
    const bad = spawnSync('python3', [...noGuard, '--catch-address', V1, '--season2-address', 'null', '--out', out], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0, bad.stdout + bad.stderr);
    assert.match(bad.stderr, /refused: wheel\/catch\.js is the v2 wallet code .* catchAddress 0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0 is the v1 contract .* this page has no not-wired guard/);
    assert.ok(!fs.existsSync(out), 'nothing written');
    const v1 = spawnSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', V1, '--season2-address', 'null', '--out', out], { encoding: 'utf8' });
    assert.equal(v1.status, 0, v1.stdout + v1.stderr);
    assert.match(v1.stderr, /^note: catchAddress 0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0 is the v1 contract: wallet visitors see the not-wired line/m);
    assert.ok(fs.readFileSync(out, 'utf8').includes('const NOT_WIRED = '), 'the built page has the guard');
    fs.rmSync(out);
    const ok = spawnSync('python3', [path.join(ROOT, 'wheel/build.py'), '--catch-address', 'null', '--season2-address', 'null', '--out', out], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(ok.stdout, /NFT button: off/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------- Season 2 (QuantumCatchV3): the reads the page adds. The same castNet / castNetWithPermit / result() as v2; a
// night is posted, then SEALED (result() status 5 = drawing until then); a caught net has its raw draw (dnaOf) and its
// picture is the chain's own (tokenURI, a big read: the public RPC first, the wallet only if that fails) ----------
// the v3 build: QC3_ARTIFACT, else contracts/out (after a forge build that has QuantumCatchV3)
const V3_JSON = process.env.QC3_ARTIFACT || path.join(ROOT, 'contracts/out/QuantumCatchV3.sol/QuantumCatchV3.json');
const V3 = fs.existsSync(V3_JSON) ? JSON.parse(fs.readFileSync(V3_JSON, 'utf8')) : null;
const S2 = '0xe7f1725e7734ce288f8367e1bb143e90bb3f0512';                 // a made-up v3 address (anvil's 2nd contract of account 0)
// a Dna as dnaOf returns it: 45 static words
const DNA = { status: 1, tier: 4, spot: 7, shots: 4000, word: '0x' + 'ab'.repeat(32), tiers: [0, 2, 1, 3, 0, 4, 0, 0, 5, 2], spots: [1, 3, 5, 7, 9, 11, 13, 15, 0, 2],
  landings: [10, 3999, 0, 1234, 77, 2500, 1, 2, 3, 4], words: Array.from({ length: 10 }, (_, k) => '0x' + (k + 1).toString(16).padStart(2, '0').repeat(32)) };
const dnaHex = (d) => '0x' + [d.status, d.tier, d.spot, d.shots].map(pad).join('') + d.word.slice(2) + d.tiers.map(pad).join('') + d.spots.map(pad).join('') + d.landings.map(pad).join('') + d.words.map((w) => w.slice(2)).join('');

test('Season 2 selectors: keccak of the signatures (ethers), and the v3 build (QC3_ARTIFACT / contracts/out) when present', (ctx) => {
  const fns = { dnaOf: 'dnaOf(uint256)', traitsOf: 'traitsOf(uint256)', locked: 'locked()', sealOf: 'sealOf(uint32)' };
  if (ethers) for (const [k, s] of Object.entries(fns)) assert.equal(QC.SEL[k], ethers.id(s).slice(0, 10), s);
  assert.equal(QC.enc.dnaOf(QC.netId(20765, ADDR)), QC.SEL.dnaOf + QC.netId(20765, ADDR).slice(2));
  assert.equal(QC.enc.sealOf(20765), QC.SEL.sealOf + pad(20765));
  assert.equal(QC.DRAWING, 5);
  if (!V3) { ctx.diagnostic(`no v3 build at ${V3_JSON}: selectors checked against ethers only`); return; }
  const ids = V3.methodIdentifiers;
  for (const [k, s] of Object.entries(fns)) assert.equal(QC.SEL[k], '0x' + ids[s], `QuantumCatchV3 ${s}`);
  // everything the page calls on a v2 contract has the same selector on v3 (casting, paying, the result, the picture)
  for (const k of ['castNet', 'castNetWithPermit', 'netCost', 'sqk', 'result', 'tokenURI']) assert.ok(Object.entries(ids).some(([s, h]) => '0x' + h === QC.SEL[k]), `v3 has ${k}`);
  const fn = (n) => V3.abi.find((a) => a.type === 'function' && a.name === n);
  // the shapes the decoders read: dnaOf = one static tuple (45 words), traitsOf = 16 words, result() = v2's 7 words
  const flat = (o) => (o.type === 'tuple' ? o.components.map(flat).reduce((a, b) => a + b, 0) : /\[(\d+)\]$/.test(o.type) ? Number(o.type.match(/\[(\d+)\]$/)[1]) : 1);
  assert.equal(fn('dnaOf').outputs.map(flat).reduce((a, b) => a + b, 0), 45, 'dnaOf: 45 static words');
  assert.deepEqual(fn('dnaOf').outputs[0].components.map((c) => `${c.type} ${c.name}`), ['uint8 status', 'uint8 tier', 'uint8 spot', 'uint32 shots', 'bytes32 word', 'uint8[10] tiers', 'uint8[10] spots', 'uint32[10] landings', 'bytes32[10] words']);
  assert.deepEqual(fn('traitsOf').outputs.map((o) => o.type), ['uint32', 'bool', 'bool', 'uint8', 'uint8', 'uint8', 'uint8[10]']);
  assert.deepEqual(fn('result').outputs.map((o) => o.type), ['uint8', 'uint32', 'uint8', 'uint16', 'uint32', 'uint8', 'uint8']);
  assert.deepEqual(fn('sealOf').outputs.map((o) => o.type), ['uint64', 'uint64', 'bytes32']);
  assert.deepEqual(fn('locked').outputs.map((o) => o.type), ['bool']);
});

test('Season 2 decoding: dnaOf (45 static words), traitsOf (the S2 shape), sealOf; ethers encodes the same bytes', () => {
  assert.deepEqual(QC.dec.dna(dnaHex(DNA)), DNA);
  assert.throws(() => QC.dec.dna('0x' + pad(1).repeat(44)), /too short/);
  const tr = '0x' + [20765, 1, 1, 7, 4, 6, 3, 0, 1, 2, 0, 1, 0, 0, 4, 1].map(pad).join('');
  assert.deepEqual(QC.dec.traits(tr), { night: 20765, drawn: true, caught: true, spot: 7, tier: 4, skin: 6, slots: [3, 0, 1, 2, 0, 1, 0, 0, 4, 1] });
  assert.deepEqual(QC.dec.seal('0x' + pad(9001) + pad(9002) + 'cd'.repeat(32)), { postBlock: 9001, seedBlock: 9002, seed: '0x' + 'cd'.repeat(32) });
  if (ethers) {
    const c = ethers.AbiCoder.defaultAbiCoder();
    assert.equal(c.encode(['tuple(uint8,uint8,uint8,uint32,bytes32,uint8[10],uint8[10],uint32[10],bytes32[10])'], [[DNA.status, DNA.tier, DNA.spot, DNA.shots, DNA.word, DNA.tiers, DNA.spots, DNA.landings, DNA.words]]), dnaHex(DNA), 'a static tuple is flat: no offset word');
  }
});

// a mock chain: v3 (S2) + Season 1 v2 (CONTRACT) answering result / dnaOf / tokenURI by token id
function chainOf(nets) {
  const log = [];
  const strHex = (s) => '0x' + pad(32) + pad(Buffer.byteLength(s)) + Buffer.from(s).toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
  const call = async (to, data) => {
    log.push([to, data.slice(0, 10)]);
    const n = nets[to + ':' + '0x' + data.slice(10)];
    if (!n) throw Object.assign(new Error('execution reverted'), { code: 3, data: QC.ERR.NonexistentToken + data.slice(10) });
    if (data.startsWith(QC.SEL.result)) return '0x' + n.r.map(pad).join('');
    if (data.startsWith(QC.SEL.dnaOf)) { if (to !== S2) throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x' }); return dnaHex(n.dna); }
    if (data.startsWith(QC.SEL.tokenURI)) return strHex('data:application/json;base64,' + Buffer.from(JSON.stringify({ name: n.name, attributes: [{ trait_type: 'Skin', value: 'Galaxy' }], image: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') })).toString('base64'));
    throw new Error('unexpected ' + data.slice(0, 10));
  };
  return { call, log };
}

test('Season 2 readNet: opts.dna reads dnaOf only for a caught net; drawing (status 5) has no spot; no opts = v2 exactly', async () => {
  const id = QC.netId(20765, ADDR), id2 = QC.netId(20764, ADDR), id3 = QC.netId(20763, ADDR);
  const { call, log } = chainOf({ [S2 + ':' + id]: { r: [1, 20765, 7, 300, 4000, 4, 0], dna: DNA }, [S2 + ':' + id2]: { r: [5, 20764, 255, 0, 4000, 0, 0] }, [CONTRACT + ':' + id3]: { r: [1, 20763, 3, 120, 4000, 2, 3] } });
  const r = await QC.readNet(call, S2, id, { dna: true });
  assert.deepEqual([r.status, r.spot, r.tier, r.looks], [1, 7, 4, 0]); assert.deepEqual(r.dna, DNA);
  const d = await QC.readNet(call, S2, id2, { dna: true });
  assert.deepEqual([d.status, d.spot, d.dna], [QC.DRAWING, null, undefined], 'posted, not sealed: drawing, nothing drawn, no dnaOf asked');
  assert.equal(log.filter(([, s]) => s === QC.SEL.dnaOf).length, 1, 'dnaOf only for the caught net');
  await assert.rejects(QC.readNet(call, CONTRACT, id3, { dna: true }), /revert/, '{ dna: true } is for Season 2 contracts only (myNets never asks Season 1 for it)');
  assert.deepEqual(await QC.readNet(call, CONTRACT, id3), { status: 1, night: 20763, spot: 3, hits: 120, shots: 4000, tier: 2, looks: 3 }, 'no opts: exactly v2 (no dna key)');
  assert.equal(await QC.readNet(call, S2, QC.netId(20760, ADDR), { dna: true }), null, 'no net: null');
});

test('Season 2 myNets: v3 then the Season 1 contract for each night (season 2 / 1), no tokenURI with images: false, dna for caught v3 nets', async () => {
  const n = (k) => QC.netId(k, ADDR);
  const { call, log } = chainOf({
    [S2 + ':' + n(20766)]: { r: [0, 20766, 255, 0, 0, 0, 0] },
    [S2 + ':' + n(20765)]: { r: [1, 20765, 7, 300, 4000, 4, 0], dna: DNA },
    [CONTRACT + ':' + n(20765)]: { r: [2, 20765, 2, 9, 4000, 0, 0] },              // the same wallet and night on v2 too (v2 stays castable)
    [CONTRACT + ':' + n(20763)]: { r: [1, 20763, 3, 120, 4000, 2, 3] },
  });
  const nets = await QC.myNets(call, S2, ADDR, [20766, 20765, 20764, 20763], { season1: CONTRACT, images: false, dna: true });
  assert.deepEqual(nets.map((x) => [x.night, x.season, x.contract, x.status, x.spot]), [[20766, 2, S2, 0, null], [20765, 2, S2, 1, 7], [20765, 1, CONTRACT, 2, 2], [20763, 1, CONTRACT, 1, 3]]);
  assert.equal(nets[1].tokenId, nets[2].tokenId, 'the same token id on both contracts');
  assert.deepEqual(nets[1].dna, DNA); assert.equal(nets[3].dna, undefined, 'no dnaOf on the Season 1 contract');
  assert.equal(log.filter(([, s]) => s === QC.SEL.tokenURI).length, 0, 'images: false: no tokenURI (the page reads pictures lazily)');
  assert.ok(nets.every((x) => x.image === null));
  const old = await QC.myNets(call, CONTRACT, ADDR, [20765, 20763]);
  assert.deepEqual(old.map((x) => [x.night, x.season, x.image && x.image.slice(0, 26)]), [[20765, undefined, 'data:image/svg+xml;base64,'], [20763, undefined, 'data:image/svg+xml;base64,']], 'without opts: as before (v2, with the picture)');
});

test('Season 2 netMeta: the public RPC first, the wallet only if it fails (gas cap, network, RendererFailed); NonexistentToken = null; lockedOf', async () => {
  const id = QC.netId(20765, ADDR);
  const { call } = chainOf({ [S2 + ':' + id]: { r: [1, 20765, 7, 300, 4000, 4, 0], dna: DNA, name: 'Quantum Catch S2 · Epic Galaxy hamster' } });
  const used = [];
  const pub = async (to, data) => { used.push('pub'); return call(to, data); };
  const m = await QC.netMeta([pub, null], S2, id);
  assert.equal(m.name, 'Quantum Catch S2 · Epic Galaxy hamster'); assert.equal(m.attr.Skin, 'Galaxy'); assert.match(m.image, /^data:image\/svg\+xml;base64,/);
  const capped = async () => { used.push('capped'); throw Object.assign(new Error('out of gas'), { code: -32000 }); };
  const failed = async () => { used.push('failed'); throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x0d1a3a5e' }); };   // RendererFailed()
  const wallet = async (to, data) => { used.push('wallet'); return call(to, data); };
  used.length = 0; assert.equal((await QC.netMeta([capped, wallet], S2, id)).attr.Skin, 'Galaxy'); assert.deepEqual(used, ['capped', 'wallet']);
  used.length = 0; assert.equal((await QC.netMeta([failed, wallet], S2, id)).attr.Skin, 'Galaxy'); assert.deepEqual(used, ['failed', 'wallet']);
  assert.equal(await QC.netMeta([pub, wallet], S2, QC.netId(20760, ADDR)), null, 'no such net: null, the wallet is not asked');
  await assert.rejects(QC.netMeta([capped, capped], S2, id), /out of gas/, 'every source failing: thrown');
  // locked(): true / false on v3; a contract without it (v2) reverts: null
  const lk = (v) => async (to, data) => { assert.equal(data, QC.enc.locked()); if (v == null) throw Object.assign(new Error('execution reverted'), { code: 3, data: '0x' }); return '0x' + pad(v ? 1 : 0); };
  assert.equal(await QC.lockedOf(lk(true), S2), true); assert.equal(await QC.lockedOf(lk(false), S2), false); assert.equal(await QC.lockedOf(lk(null), CONTRACT), null);
  await assert.rejects(QC.lockedOf(async () => { throw new Error('Failed to fetch'); }, S2), /Failed to fetch/, 'a network error is not "no lock"');
});

test('Season 2 reads: dnaOf / locked selectors (= forge methodIdentifiers), the raw DNA decoded, readNet with dna', async () => {
  const out = path.join(ROOT, 'contracts/out/QuantumCatchV3.sol/QuantumCatchV3.json');
  if (fs.existsSync(out)) {
    const m = JSON.parse(fs.readFileSync(out, 'utf8')).methodIdentifiers;
    assert.equal(QC.SEL.dnaOf, '0x' + m['dnaOf(uint256)']);
    assert.equal(QC.SEL.locked, '0x' + m['locked()']);
    assert.equal(QC.SEL.result, '0x' + m['result(uint256)'], 'v3 keeps result(uint256): readNet reads both seasons');
    assert.equal(QC.SEL.tokenURI, '0x' + m['tokenURI(uint256)']);
  }
  if (ethers) for (const [k, sig] of [['dnaOf', 'dnaOf(uint256)'], ['locked', 'locked()']]) assert.equal(QC.SEL[k], ethers.id(sig).slice(0, 10), sig);
  const id = QC.netId(20761, ADDR);
  assert.equal(QC.enc.dnaOf(id), QC.SEL.dnaOf + id.slice(2));
  // a caught net's DNA as the contract returns it (a static struct: 45 words in order)
  const w = (i) => '0x' + (BigInt(i) * 0x1111n).toString(16).padStart(64, '0');
  const d = { status: 1, tier: 4, spot: 7, shots: 4000, word: w(99), tiers: [0, 1, 2, 3, 4, 5, 1, 1, 0, 2], spots: [3, 0, 1, 5, 7, 9, 11, 13, 15, 2],
    landings: [10, 20, 30, 40, 50, 60, 70, 80, 90, 3999], words: Array.from({ length: 10 }, (_, k) => w(k + 1)) };
  const hex = '0x' + [d.status, d.tier, d.spot, d.shots, d.word, ...d.tiers, ...d.spots, ...d.landings, ...d.words].map((x) => (typeof x === 'string' ? x.slice(2) : pad(x))).join('');
  if (ethers) {
    const DNA = 'tuple(uint8 status,uint8 tier,uint8 spot,uint32 shots,bytes32 word,uint8[10] tiers,uint8[10] spots,uint32[10] landings,bytes32[10] words)';
    assert.equal(hex, ethers.AbiCoder.defaultAbiCoder().encode([DNA], [d]), 'the same bytes as the ABI encoder');
  }
  assert.deepEqual(QC.dec.dna(hex), d);
  assert.throws(() => QC.dec.dna(hex.slice(0, hex.length - 64)), /too short/);
  // readNet: status 5 (drawing) passes through; a caught net with { dna: true } also reads dnaOf
  const calls = [];
  const call = (status) => async (to, data) => {
    calls.push(data.slice(0, 10));
    if (data.startsWith(QC.SEL.result)) return '0x' + [status, 20761, status === 1 ? 7 : 255, 254, 4000, status === 1 ? 4 : 0, 0].map(pad).join('');
    if (data.startsWith(QC.SEL.dnaOf)) return hex;
    throw new Error('unexpected call ' + data.slice(0, 10));
  };
  const drawing = await QC.readNet(call(5), CONTRACT, id, { dna: true });
  assert.equal(drawing.status, 5);
  assert.equal(drawing.spot, null, 'nothing drawn until sealed');
  assert.equal(drawing.dna, undefined);
  const caught = await QC.readNet(call(1), CONTRACT, id, { dna: true });
  assert.deepEqual(caught.dna, d);
  calls.length = 0;
  const plain = await QC.readNet(call(1), CONTRACT, id);
  assert.equal(plain.dna, undefined, 'no dnaOf call without { dna: true } (Season 1 contracts have none)');
  assert.deepEqual(calls, [QC.SEL.result]);
});
