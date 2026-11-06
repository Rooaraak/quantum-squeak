// Quantum Catch logic (wheel/catch.js): the night clock and the 21:00 UTC net lock (same rules as contracts/src/QuantumCatch.sol),
// local nets (one per night), token ids, hand-made ABI encoding/decoding, the wallet flow against a mocked EIP-1193 provider,
// and the live SqueekCore read (decoded from a real recorded Sepolia response). Reach and rarity (the owner's rules) are
// checked against the Python reference wheel/test/tier_ref.py on every spot.   node --test wheel/test/catch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
  assert.equal(QC.enc.castNet(15), '0x6af74e5f' + pad(15));
  assert.equal(QC.enc.castNet(0), '0x6af74e5f' + pad(0));
  for (const bad of [16, -1, 1.5, '2']) assert.throws(() => QC.enc.castNet(bad), /spot/);
  const id = QC.netId(20761, ADDR);
  assert.equal(QC.enc.result(id), '0x3c594059' + id.slice(2));
  assert.equal(QC.enc.tokenURI(id), '0xc87b56dd' + id.slice(2));
  assert.equal(QC.enc.state(), '0xc19d93fb');
  assert.ok(FIX.calls[QC.enc.roundPage(97, 241, 16)], 'roundPage(97, 241, 16) is the recorded call');
  assert.throws(() => QC.enc.roundPage(97, 241, 17), /16/);
  const out = path.join(ROOT, 'contracts/out/QuantumCatch.sol/QuantumCatch.json');
  if (fs.existsSync(out)) {
    const m = JSON.parse(fs.readFileSync(out, 'utf8')).methodIdentifiers;
    assert.equal(QC.SEL.castNet, '0x' + m['castNet(uint8)']); assert.equal(QC.SEL.result, '0x' + m['result(uint256)']); assert.equal(QC.SEL.tokenURI, '0x' + m['tokenURI(uint256)']);
  }
  if (ethers) {
    for (const [k, sig] of [['castNet', 'castNet(uint8)'], ['result', 'result(uint256)'], ['tokenURI', 'tokenURI(uint256)'], ['state', 'state()'], ['roundPage', 'roundPage(uint64,uint64,uint256)']]) assert.equal(QC.SEL[k], ethers.id(sig).slice(0, 10), sig);
    assert.equal(QC.TOPIC_NETCAST, ethers.id('NetCast(uint32,address,uint8,uint256)'));
    assert.equal(QC.ERR.AlreadyCast, ethers.id('AlreadyCast(uint32,address)').slice(0, 10));
    assert.equal(QC.ERR.NonexistentToken, ethers.id('NonexistentToken(uint256)').slice(0, 10));
  }
});

test('decoding result(), strings, NetCast logs and on-chain metadata', () => {
  const r = QC.dec.result('0x' + [1, 20761, 15, 808, 4000, 1, 15].map(pad).join(''));
  assert.deepEqual(r, { status: 1, night: 20761, spot: 15, hits: 808, shots: 4000, tier: 1, looks: 15 });
  assert.throws(() => QC.dec.result('0x' + pad(1)), /short/);
  const word = (s) => Buffer.from(s, 'utf8').toString('hex').padEnd(Math.ceil(Buffer.byteLength(s) / 32) * 64, '0');
  const str = (s) => '0x' + pad(32) + pad(Buffer.byteLength(s)) + word(s);
  assert.equal(QC.dec.string(str('hello')), 'hello');
  assert.equal(QC.dec.string(str('Quantum Catch · night of 2026-11-04 · ✓')), 'Quantum Catch · night of 2026-11-04 · ✓');
  const id = QC.netId(20762, ADDR);
  const log = { address: CONTRACT, topics: [QC.TOPIC_NETCAST, '0x' + pad(20762), '0x' + pad(ADDR)], data: '0x' + pad(6) + id.slice(2) };
  assert.deepEqual(QC.dec.netCast(log), { night: 20762, catcher: ADDR, spot: 6, tokenId: id });
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
const ALLOWED = new Set(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_sendTransaction', 'eth_getTransactionReceipt']);
function mockWallet(o = {}) {
  const calls = [];
  let chain = o.chain || '0x1', sent = null, polls = 0;
  const err = (code, message, data) => Object.assign(new Error(message), { code, data });
  const eth = {
    calls,
    async request({ method, params }) {
      calls.push({ method, params });
      assert.ok(ALLOWED.has(method), `the page never asks the wallet for ${method}`);
      switch (method) {
        case 'eth_requestAccounts': if (o.noAccounts) throw err(4001, 'User rejected the request.'); return [ADDR.toUpperCase().replace('0X', '0x')];
        case 'eth_accounts': return [ADDR];
        case 'eth_chainId': return chain;
        case 'eth_getBalance': if (o.walletBalanceFails) throw new Error('not supported'); assert.equal(chain, '0xaa36a7', 'the balance is asked only on Sepolia'); return o.walletBalance || '0x56bc75e2d63100000';
        case 'eth_getBlockByNumber': if (o.noBlock) throw new Error('not supported'); return { number: '0x10', timestamp: '0x' + Math.floor((o.blockMs || NOW) / 1000).toString(16) };
        case 'wallet_switchEthereumChain':
          if (o.switchRejected) throw err(4001, 'User rejected the request.');
          if (o.unknownChain && !eth.added) throw err(4902, 'Unrecognized chain ID "0xaa36a7".');
          chain = params[0].chainId; return null;
        case 'wallet_addEthereumChain': eth.added = params[0]; chain = params[0].chainId; return null;
        case 'eth_call': {
          const d = params[0].data;
          if (d.startsWith(QC.SEL.result)) { if (o.alreadyHas) return '0x' + [0, 20762, 3, 0, 0, 0, 3].map(pad).join(''); throw err(3, 'execution reverted', QC.ERR.NonexistentToken + d.slice(10)); }
          throw new Error('unexpected eth_call ' + d.slice(0, 10));
        }
        case 'eth_sendTransaction':
          if (o.sendError) throw o.sendError;
          sent = params[0]; return '0x' + 'ab'.repeat(32);
        case 'eth_getTransactionReceipt': {
          if (++polls < 3) return null;
          if (o.failed) return { status: '0x0', logs: [] };
          const n = o.chainNight || 20762, id = QC.netId(n, ADDR);
          return { status: '0x1', logs: [{ address: CONTRACT, topics: ['0x' + pad(7), '0x0', '0x0'], data: '0x' }, { address: CONTRACT.toUpperCase().replace('0X', '0x'), topics: [QC.TOPIC_NETCAST, '0x' + pad(n), '0x' + pad(ADDR)], data: '0x' + pad(sent ? BigInt(sent.data.slice(-64)) : 0) + id.slice(2) }] };
        }
      }
      throw new Error('unexpected ' + method);
    },
  };
  return eth;
}
const NOW = Date.parse('2026-11-05T17:30:00Z');
const fastOpts = (extra) => ({ now: () => NOW, sleep: () => Promise.resolve(), pollMs: 1, timeoutMs: 1e9, ...extra });

test('wallet: connect, add + switch to Sepolia, one castNet transaction, token id and night from the NetCast log', async () => {
  const eth = mockWallet({ unknownChain: true }), steps = [];
  const r = await QC.castNetNft(eth, CONTRACT, 6, fastOpts({ onStep: (s) => steps.push(s) }));
  assert.deepEqual(r, { txHash: '0x' + 'ab'.repeat(32), night: 20762, day: '2026-11-05', spot: 6, tokenId: QC.netId(20762, ADDR), catcher: ADDR });
  assert.equal(eth.added.chainId, '0xaa36a7'); assert.equal(eth.added.nativeCurrency.symbol, 'ETH'); assert.ok(eth.added.rpcUrls[0].startsWith('https://'));
  const sends = eth.calls.filter((c) => c.method === 'eth_sendTransaction');
  assert.equal(sends.length, 1, 'exactly one transaction');
  assert.deepEqual(sends[0].params[0], { from: ADDR, to: CONTRACT, data: QC.enc.castNet(6), value: '0x0' });
  assert.deepEqual(steps, ['connect', 'network', 'check', 'send', 'wait', 'done']);
  // the chain's own night wins over the viewer's clock (a cast right at 21:00 UTC can land in the next night)
  const late = await QC.castNetNft(mockWallet({ chain: '0xaa36a7', chainNight: 20763 }), CONTRACT, 2, fastOpts());
  assert.equal(late.night, 20763); assert.equal(late.day, '2026-11-06');
  // the "already cast?" check asks about the night of the chain's latest block (not the viewer's clock), else the viewer's clock
  const chk = mockWallet({ chain: '0xaa36a7', blockMs: Date.parse('2026-11-05T21:30:00Z') });
  await QC.castNetNft(chk, CONTRACT, 2, fastOpts());
  assert.equal(chk.calls.find((c) => c.method === 'eth_call').params[0].data, QC.enc.result(QC.netId(20763, ADDR)), 'after 21:00 UTC chain time: the 6 Nov net');
  const nob = mockWallet({ chain: '0xaa36a7', noBlock: true });
  await QC.castNetNft(nob, CONTRACT, 2, fastOpts());
  assert.equal(nob.calls.find((c) => c.method === 'eth_call').params[0].data, QC.enc.result(QC.netId(20762, ADDR)), 'no block: the viewer\'s clock (5 Nov)');
});

test('wallet: plain-word errors; nothing is sent when this wallet already has tonight\'s net', async () => {
  const say = async (o, spot = 6) => { try { await QC.castNetNft(mockWallet(o), CONTRACT, spot, fastOpts()); return 'no error'; } catch (e) { return QC.plainError(e); } };
  const already = mockWallet({ chain: '0xaa36a7', alreadyHas: true });
  await assert.rejects(QC.castNetNft(already, CONTRACT, 6, fastOpts()), (e) => e.code === 'already');
  assert.equal(already.calls.filter((c) => c.method === 'eth_sendTransaction').length, 0, 'no transaction when the net exists');
  assert.match(await say({ chain: '0xaa36a7', alreadyHas: true }), /already has a net/);
  assert.match(await say({ noAccounts: true }), /said no in your wallet\. Nothing was sent/);
  assert.match(await say({ switchRejected: true }), /Sepolia test network/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('User denied transaction signature.'), { code: 4001 }) }), /said no in your wallet\. Nothing was sent/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('insufficient funds for gas * price + value'), { code: -32000 }) }), /Sepolia test ETH/);
  assert.match(await say({ chain: '0xaa36a7', sendError: Object.assign(new Error('execution reverted'), { code: 3, data: QC.ERR.AlreadyCast + pad(20762) + pad(ADDR) }) }), /already has a net/);
  assert.match(await say({ chain: '0xaa36a7', sendError: { code: -32603, message: 'Internal JSON-RPC error.', data: { originalError: { data: QC.ERR.AlreadyCast + pad(1) + pad(ADDR) } } } }), /already has a net/, 'nested error data (MetaMask style)');
  assert.match(await say({ chain: '0xaa36a7', failed: true }), /did not go through/);
  assert.match(await say({ chain: '0xaa36a7' }, 16), /spot/);
  assert.match(QC.plainError(Object.assign(new Error('x'), { code: -32002 })), /already asking you something/);
  assert.match(QC.plainError(new Error('weird')), /Something went wrong/);
  assert.match(QC.plainError({ code: 'timeout' }), /may still arrive/);
  assert.match(QC.plainError({ code: 'nowallet' }), /wallet/);
});

test('wallet: no Sepolia test ETH stops before the network prompt (public RPC check), or before the send (the wallet\'s own check)', async () => {
  const say = (e) => QC.plainError(e);
  const a = mockWallet(), seen = [];
  await assert.rejects(QC.castNetNft(a, CONTRACT, 6, fastOpts({ balance: async (who) => { seen.push(who); return 0n; } })), (e) => e.code === 'nofunds' && /no Sepolia test ETH.*faucet.*Nothing was sent/.test(say(e)));
  assert.deepEqual(a.calls.map((c) => c.method), ['eth_requestAccounts'], 'one prompt (connect), then the faucet line: no network switch, no transaction');
  assert.deepEqual(seen, [ADDR], 'the balance of the connected account');
  // the public RPC is blocked (null/throws): the wallet's own read-only eth_getBalance once it is on Sepolia
  for (const balance of [async () => { throw new Error('Failed to fetch'); }, undefined]) {
    const b = mockWallet({ unknownChain: true, walletBalance: '0x0' });
    await assert.rejects(QC.castNetNft(b, CONTRACT, 6, fastOpts({ balance })), (e) => e.code === 'nofunds');
    assert.ok(!b.calls.some((c) => c.method === 'eth_sendTransaction'), 'nothing sent');
    assert.ok(b.calls.some((c) => c.method === 'eth_getBalance'));
  }
  // with funds (either check) the one transaction goes out; an unanswered check never blocks it
  for (const [balance, o] of [[async () => 10n ** 15n, {}], [async () => { throw new Error('x'); }, { walletBalanceFails: true }]]) {
    const c = mockWallet({ chain: '0xaa36a7', ...o });
    const r = await QC.castNetNft(c, CONTRACT, 6, fastOpts({ balance }));
    assert.equal(r.spot, 6); assert.equal(c.calls.filter((x) => x.method === 'eth_sendTransaction').length, 1);
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
  const have = { [QC.netId(20761, ADDR)]: [1, 20761, 15, 808, 4000, 1, 15], [QC.netId(20759, ADDR)]: [2, 20759, 0, 12, 4000, 0, 0] };
  const seen = [];
  const call = async (to, data) => {
    assert.equal(to, CONTRACT); seen.push(data.slice(0, 10));
    const id = '0x' + data.slice(10);
    if (!have[id]) throw Object.assign(new Error('execution reverted'), { code: 3, data: QC.ERR.NonexistentToken + data.slice(10) });
    return data.startsWith(QC.SEL.result) ? '0x' + have[id].map(pad).join('') : enc(uri);
  };
  const nets = await QC.myNets(call, CONTRACT, ADDR, [20762, 20761, 20760, 20759]);
  assert.deepEqual(nets.map((x) => [x.night, x.status, x.spot, x.tier]), [[20761, 1, 15, 1], [20759, 2, 0, 0]]);
  assert.equal(nets[0].tokenId, QC.netId(20761, ADDR));
  assert.equal(nets[0].image, 'data:image/svg+xml;base64,' + svg);
  assert.equal(seen.filter((s) => s === QC.SEL.tokenURI).length, 2);
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
