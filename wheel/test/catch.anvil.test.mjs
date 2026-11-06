// The page's hand-made wallet code against the REAL QuantumCatch contract on a LOCAL anvil chain (never a public network):
// deploy contracts/out bytecode, cast nets through wheel/catch.js over a minimal EIP-1193 shim, post the real chip results
// of 31 Oct (one net on each of the 16 spots: 8 out of reach, most of them with 1 % or more of the landings) and 4 Nov as
// the poster (with the chip's first shot), and 1 Nov with a made-up first shot on its Epic spot (Legendary), then read
// result() + reachOf() + tokenURI() back with the page's own decoders and compare with QC.outcome (the owner's rarity rule).
//   node --test wheel/test/catch.anvil.test.mjs      (on a shared box, run it under the heavy-job lock)
// Needs anvil (ANVIL, else wheel/test/local.json {"anvil": ...}, else PATH) and a QuantumCatch build of the rarity rule
// (postNight with firstShot): QC_ARTIFACT=<out>/QuantumCatch.sol/QuantumCatch.json, else contracts/out (forge build).
// Skips, saying why, without them; never runs against an older build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = new URL('.', import.meta.url).pathname;
const ROOT = path.resolve(here, '../..');
const QC = require(here + '../catch.js');
const QW = require(here + '../engine.js');
const LOCAL = (() => { try { return JSON.parse(fs.readFileSync(path.join(here, 'local.json'), 'utf8')); } catch (e) { return {}; } })();
const ANVIL = process.env.ANVIL || LOCAL.anvil || 'anvil';
const OUT = process.env.QC_ARTIFACT || path.join(ROOT, 'contracts/out/QuantumCatch.sol/QuantumCatch.json');
const POST_SIG = 'postNight(uint32,uint16[16],uint32,uint8,bytes32,bytes32,uint8)';      // the rarity rule: with the first shot
const CHIP = path.join(ROOT, 'quantum/wheel-2026-11-04-ibm_marrakesh-dbmaa9u74qds73dru4d0.json');
const CHIP31 = path.join(ROOT, 'quantum/wheel-2026-10-31-ibm_marrakesh-dbmbiau74qds73ds0hug.json');
const CHIP01 = path.join(ROOT, 'quantum/wheel-2026-11-01-ibm_marrakesh-dbmbidt8ft8s738uiq60.json');
const skip = (() => {
  try { execFileSync(ANVIL, ['--version'], { stdio: 'ignore' }); } catch (e) { return 'no anvil'; }
  if (!fs.existsSync(OUT)) return `no contract build at ${OUT}`;
  if (!JSON.parse(fs.readFileSync(OUT, 'utf8')).methodIdentifiers[POST_SIG]) return `the contract build at ${OUT} predates the rarity rule (no ${POST_SIG}): forge build, or QC_ARTIFACT`;
  return false;
})();
const PORT = 18000 + (process.pid % 2000), RPC = `http://127.0.0.1:${PORT}`;
const START = 1793800000, OVER = 1793880000, N = 20761;                 // 4 Nov 13:46:40 UTC; 5 Nov 12:00 UTC = night 20761 is over
const OCT31 = 1793451600, N31 = 20757;                                  // 31 Oct 13:00 UTC: nets go to the 31 Oct night
const NOV1 = OCT31 + 86400, N01 = 20758;                                // 1 Nov 13:00 UTC: nets go to the 1 Nov night
const pad = (x) => BigInt(x).toString(16).padStart(64, '0');

let rpcId = 0;
async function rpc(method, params = []) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
  return j.result;
}
// what a browser wallet does for the page: its own account, Sepolia already selected, everything else to the node
const wallet = (account) => ({
  log: [],
  async request({ method, params }) {
    this.log.push(method);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
    if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
    return rpc(method, params || []);
  },
});
const receipt = async (h) => { for (let i = 0; i < 100; i++) { const r = await rpc('eth_getTransactionReceipt', [h]); if (r) return r; await new Promise((s) => setTimeout(s, 50)); } throw new Error('no receipt'); };

// the night as the poster sends it (post_night.mjs): landings per SPOT (the ring turn applied), his total turns, the steps,
// the spot of the chip's very first shot (shots_in_order[0], turned)
const nightOf = (f) => { const R = JSON.parse(fs.readFileSync(f, 'utf8')), T = QW.ringTurn(R.rounds.map((r) => r[1]));
  return { R, perSpot: QW.turned(R.counts, T), turns: R.rounds.reduce((a, r) => a + r[1], 0), steps: R.steps.length, first: QW.spotOf(R.shots_in_order[0], T) }; };
const recOf = (x) => ({ counts: x.perSpot, shots: x.R.wheel_shots, turns: x.turns, steps: x.steps, firstShot: x.first });

test('catch.js against the real QuantumCatch on local anvil (chain id 11155111): cast, already-cast, post 31 Oct + 1 Nov + 4 Nov, result + reach + tokenURI', { skip: skip }, async () => {
  const anvil = spawn(ANVIL, ['--host', '127.0.0.1', '--port', String(PORT), '--chain-id', '11155111', '--timestamp', String(OCT31), '--accounts', '26', '--silent'], { stdio: 'ignore' });
  try {
    for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch (e) { if (i > 100) throw e; await new Promise((r) => setTimeout(r, 100)); } }
    assert.equal(await rpc('eth_chainId'), '0xaa36a7', 'local anvil posing as Sepolia');
    const acc = (await rpc('eth_accounts')).map((a) => a.toLowerCase());
    const [hatcher, p1, p2, p3, p4, q1, q2, deployer] = [acc[0], acc[1], acc[2], acc[3], acc[4], acc[5], acc[6], acc[9]];
    const bytecode = JSON.parse(fs.readFileSync(OUT, 'utf8')).bytecode.object;
    assert.ok(!bytecode.includes('__$'), 'no unlinked libraries');
    const dep = await receipt(await rpc('eth_sendTransaction', [{ from: deployer, data: bytecode + pad(hatcher) + pad(0), gas: '0x1c9c380' }]));   // (hatcher, no painted art)
    const runtime = (JSON.parse(fs.readFileSync(OUT, 'utf8')).deployedBytecode.object.length - 2) / 2;
    assert.equal(dep.status, '0x1', `the deploy failed (runtime ${runtime} bytes; the EIP-170 limit is 24,576)`);
    const C = dep.contractAddress.toLowerCase();
    assert.notEqual(await rpc('eth_getCode', [C, 'latest']), '0x', 'the contract has code');
    const ids = JSON.parse(fs.readFileSync(OUT, 'utf8')).methodIdentifiers, sig = Object.keys(ids).find((k) => k.startsWith('postNight('));
    assert.equal(sig, POST_SIG, 'the contract takes the night\'s steps (reach) and the first shot (Legendary)');
    const postData = (n, x) => '0x' + ids[sig] + pad(n) + x.perSpot.map(pad).join('') + pad(x.turns) + pad(x.steps) + Buffer.from(x.R.job_id, 'ascii').toString('hex').padEnd(64, '0') + pad(1) + pad(x.first);

    // 31 Oct: one net on every spot (16 wallets), cast before 21:00 UTC that day
    const oct = acc.slice(10, 26);
    for (let s = 0; s < 16; s++) {
      const r = await QC.castNetNft(wallet(oct[s]), C, s, { now: () => OCT31 * 1000, pollMs: 30 });
      assert.equal(r.night, N31); assert.equal(r.spot, s);
    }
    // 1 Nov: a net on its Epic spot (14) and one on a Common spot (6)
    await rpc('evm_setNextBlockTimestamp', [NOV1]); await rpc('evm_mine');
    for (const [who, s] of [[q1, 14], [q2, 6]]) assert.equal((await QC.castNetNft(wallet(who), C, s, { now: () => NOV1 * 1000, pollMs: 30 })).night, N01);
    await rpc('evm_setNextBlockTimestamp', [START]); await rpc('evm_mine');

    const cast = async (who, spot) => QC.castNetNft(wallet(who), C, spot, { now: () => START * 1000, pollMs: 30 });
    const r1 = await cast(p1, 15);
    assert.deepEqual(r1, { txHash: r1.txHash, night: N, day: '2026-11-04', spot: 15, tokenId: QC.netId(N, p1), catcher: p1 });
    assert.equal(await rpc('eth_call', [{ to: C, data: '0x6352211e' + r1.tokenId.slice(2) }, 'latest']), '0x' + pad(p1), 'ownerOf(tokenId) = the caster');
    assert.deepEqual(await QC.readNet(QC.walletCall(wallet(p1)), C, r1.tokenId), { status: 0, night: N, spot: 15, hits: 0, shots: 0, tier: 0, looks: 15 }, 'waiting for the chip');
    // one per wallet per night: the page checks first and sends nothing; the contract's own revert is also put in plain words
    const w = wallet(p1);
    await assert.rejects(QC.castNetNft(w, C, 3, { now: () => START * 1000, pollMs: 30 }), (e) => e.code === 'already');
    assert.ok(!w.log.includes('eth_sendTransaction'));
    const rev = await rpc('eth_call', [{ from: p1, to: C, data: QC.enc.castNet(3) }, 'latest']).then(() => null, (e) => e);
    assert.ok(rev && QC.isRevert(rev)); assert.match(QC.plainError(rev), /already has a net/);
    assert.equal(QC.dec.result(await rpc('eth_call', [{ to: C, data: QC.enc.result(r1.tokenId) }, 'latest'])).spot, 15);
    const waitMeta = QC.tokenMeta(QC.dec.string(await rpc('eth_call', [{ to: C, data: QC.enc.tokenURI(r1.tokenId) }, 'latest'])));
    assert.equal(waitMeta.name, 'Quantum Catch: night of 2026-11-04, spot 15'); assert.match(waitMeta.image, /^data:image\/svg\+xml;base64,/);
    await cast(p2, 0); await cast(p3, 5); await cast(p4, 11);

    // the nights are over: the poster posts the real 31 Oct and 4 Nov chip results, per SPOT, with the chip's first shot, as
    // post_night.mjs; 1 Nov with a MADE-UP first shot on its Epic spot 14 (its real first shot landed on 6), so the
    // Legendary path runs on the real contract (local anvil only)
    const x4 = nightOf(CHIP), x31 = nightOf(CHIP31), x01 = { ...nightOf(CHIP01) }, perSpot = x4.perSpot;
    assert.deepEqual(perSpot, [27, 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808]);
    assert.deepEqual([x31.first, x4.first, x01.first], [13, 15, 6], 'the real first shots, turned onto the ring');
    assert.equal(QW.tiers(x01.perSpot, x01.turns, x01.steps, x01.first)[14], 3, '1 Nov: spot 14 (151 of 4,000) is the Epic spot');
    x01.first = 14;
    await rpc('evm_setNextBlockTimestamp', [OVER]); await rpc('evm_mine');
    for (const [n, x] of [[N31, x31], [N01, x01], [N, x4]]) assert.equal((await receipt(await rpc('eth_sendTransaction', [{ from: hatcher, to: C, data: postData(n, x) }]))).status, '0x1');

    // 31 Oct, all 16 spots: the page's QC.outcome = the contract's result() and reachOf(); out of reach never catches
    const rec31 = recOf(x31);
    let outLoud = 0;
    for (let s = 0; s < 16; s++) {
      const [x] = await QC.myNets(QC.walletCall(wallet(oct[s])), C, oct[s], [N31]), o = QC.outcome(rec31, s);
      assert.deepEqual([x.status, x.hits, x.tier, x.shots, x.spot], [o.status, o.hits, o.tier, o.shots, s], `31 Oct spot ${s}: page = contract`);
      const reach = Number(BigInt(await rpc('eth_call', [{ to: C, data: '0x' + ids['reachOf(uint256)'] + x.tokenId.slice(2) }, 'latest'])));
      assert.equal(reach, o.reach, `31 Oct spot ${s}: same reach`);
      const svg = Buffer.from(x.image.split(',')[1], 'base64').toString('utf8');
      if (o.reach === 2) { assert.equal(x.status, 2); assert.equal(x.tier, 0); assert.match(svg, /OUT OF REACH/); if (o.hits * 100 >= o.shots) outLoud++; }
      else assert.equal(x.status, 1, `31 Oct spot ${s} in reach: caught`);
    }
    assert.equal(outLoud, 8, 'all 8 out-of-reach spots of 31 Oct had 1 % or more of the landings, and none of them caught');
    const t31 = [...Array(16).keys()].map((s) => QC.outcome(rec31, s).tier);
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => t31.filter((v) => v === k).length), [4, 2, 1, 1, 0], '31 Oct on-chain: 4 Common, 2 Uncommon, 1 Rare, 1 Epic');

    // 1 Nov: the net on the Epic spot hit by the (made-up) first shot is Legendary on the contract and on the page
    for (const [who, s, tier] of [[q1, 14, 5], [q2, 6, 1]]) {
      const [x] = await QC.myNets(QC.walletCall(wallet(who)), C, who, [N01]), o = QC.outcome(recOf(x01), s);
      assert.deepEqual([x.status, x.hits, x.tier, x.shots], [o.status, o.hits, o.tier, o.shots], `1 Nov spot ${s}: page = contract`);
      assert.equal(x.tier, tier, `1 Nov spot ${s}: tier ${tier}`);
    }
    assert.deepEqual([QC.outcome(rec31, 0).hits, QC.outcome(rec31, 0).status], [46, 2], 'the 46/4000 vector of the contract\'s own tests');

    // the page reads every net back: result() through eth_call, the on-chain picture through tokenURI()
    const page = { [N]: recOf(x4) };
    for (const [who, spot, want] of [[p1, 15, [1, 808, 1]], [p2, 0, [2, 27, 0]], [p3, 5, [1, 308, 2]], [p4, 11, [1, 289, 4]]]) {
      const nets = await QC.myNets(QC.walletCall(wallet(who)), C, who, [N + 1, N, N - 1]);
      assert.equal(nets.length, 1, 'one net, on the 4 Nov night');
      const x = nets[0];
      assert.deepEqual([x.status, x.hits, x.tier, x.shots, x.night, x.spot, x.day], [...want, 4000, N, spot, '2026-11-04']);
      const o = QC.outcome(page[N], spot);
      assert.deepEqual([o.status, o.hits, o.tier, o.shots], [x.status, x.hits, x.tier, x.shots], `the page's own outcome for spot ${spot} = the contract's`);
      assert.equal(o.reach, spot % 2 ? 1 : 2, '4 Nov: the odd spots were in reach');
      assert.match(x.image, /^data:image\/svg\+xml;base64,/);
      assert.match(Buffer.from(x.image.split(',')[1], 'base64').toString('utf8'), /^<svg/);
      assert.equal(x.name, `Quantum Catch: night of 2026-11-04, spot ${spot}`);
    }
    // after the post, a new net goes to the open night (5 Nov) at chain time, and the page takes the night from the log
    const late = await QC.castNetNft(wallet(p1), C, 9, { now: () => START * 1000, pollMs: 30 });   // the viewer's clock is wrong on purpose
    assert.equal(late.night, N + 1); assert.equal(late.day, '2026-11-05'); assert.equal(late.tokenId, QC.netId(N + 1, p1));
  } finally { anvil.kill('SIGTERM'); }
});
