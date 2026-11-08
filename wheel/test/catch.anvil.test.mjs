// The page's hand-made wallet code (wheel/catch.js) against the REAL QuantumCatch v2 contract on a LOCAL anvil chain (never a
// public network; chain id 11155111 like Sepolia), over a minimal EIP-1193 shim that allows only the wallet methods the page
// needs. v2 (the owner's rules of 6 Nov): castNet() takes NO spot; once the hatcher posts a night, the contract draws each
// net's shot over all the night's landings (drawOf); a net may cost test SQK, burned; the holder can burn a net.
//  1. Free nets (SQK unset, NET_COST 0: no token at all). 31 Oct: one net drawn on each of the 16 spots (8 out of reach,
//     each with 1 % or more of the landings), its casters found BEFORE they cast with the contract's own pure drawOf (only a
//     test knows the result file's sha256 and the job id before the chip runs; anvil impersonates any address). 1 Nov: a net
//     drawn on its Epic spot 14 with a made-up first shot there (Legendary) and one on a Common spot. 4 Nov: four nets of
//     anvil's own accounts, whatever they draw. The hatcher posts the three nights (the real chip results, per SPOT, with
//     the first shot, as post_night.mjs), then result() + spotOf() + reachOf() + traitsOf() + tokenURI() are read back with
//     the page's decoders and compared with QC.outcome on the drawn spot (the owner's rarity rule). Burn (amendment 3).
//  2. Paid nets: a mock test SQK (contracts/test/mocks/MockSqk.sol: the real token's OpenZeppelin errors, burn(uint256),
//     EIP-2612 permit; also MockSqkNoDomain without eip712Domain()) and the SqkFaucet (DRIP 0.01 once per wallet per net
//     night): NO_SQK, the faucet (claimed / empty / refilled by a plain transfer / open again the next net night), the permit
//     path (ONE signature + ONE castNetWithPermit, burns exactly NET_COST, the game keeps nothing), the approve fallback, an
//     allowance in place, a "no", a page set up for another token, a burned net, the live v1's empty NET_COST() revert.
//   node --test wheel/test/catch.anvil.test.mjs      (on a shared box, run it under the heavy-job lock)
// Needs anvil (ANVIL, else wheel/test/local.json {"anvil": ...}, else PATH) and a v2 build (forge build in contracts/):
// QC_ARTIFACT=<out>/QuantumCatch.sol/QuantumCatch.json (the same out/ holds MockSqk and SqkFaucet), else contracts/out.
// Skips, saying why, without them; never runs against an older build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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
const OUTDIR = path.resolve(path.dirname(OUT), '..');
const MOCK = path.join(OUTDIR, 'MockSqk.sol/MockSqk.json'), MOCK_ND = path.join(OUTDIR, 'MockSqk.sol/MockSqkNoDomain.json');
const FAUCET = path.join(OUTDIR, 'SqkFaucet.sol/SqkFaucet.json');
const POST_SIG = 'postNight(uint32,uint16[16],uint32,uint8,bytes32,bytes32,uint8)';      // the rarity rule: with the first shot
const DRAW_SIG = 'drawOf(uint32,bytes32,bytes32,uint256,uint16[16])';                    // v2: the net's shot, drawn
const CHIP = path.join(ROOT, 'quantum/wheel-2026-11-04-ibm_marrakesh-dbmaa9u74qds73dru4d0.json');
const CHIP31 = path.join(ROOT, 'quantum/wheel-2026-10-31-ibm_marrakesh-dbmbiau74qds73ds0hug.json');
const CHIP01 = path.join(ROOT, 'quantum/wheel-2026-11-01-ibm_marrakesh-dbmbidt8ft8s738uiq60.json');
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const skip = (() => {
  try { execFileSync(ANVIL, ['--version'], { stdio: 'ignore' }); } catch (e) { return 'no anvil'; }
  for (const f of [OUT, MOCK, MOCK_ND, FAUCET]) if (!fs.existsSync(f)) return `no contract build at ${f}: forge build, or QC_ARTIFACT`;
  const ids = load(OUT).methodIdentifiers;
  if (!ids[POST_SIG]) return `the contract build at ${OUT} predates the rarity rule (no ${POST_SIG}): forge build, or QC_ARTIFACT`;
  for (const s of ['castNet()', 'castNetWithPermit(uint256,uint8,bytes32,bytes32)', DRAW_SIG, 'spotOf(uint256)', 'burn(uint256)', 'traitsOf(uint256)', 'NET_COST()']) {
    if (!ids[s]) return `the contract build at ${OUT} is not the v2 game (no ${s}): forge build, or QC_ARTIFACT`;
  }
  if (ids['castNet(uint8)']) return `the contract build at ${OUT} still takes a spot (castNet(uint8)): forge build, or QC_ARTIFACT`;
  const fc = (load(FAUCET).abi.find((x) => x.type === 'constructor')?.inputs || []).map((i) => i.type).join(',');
  if (fc !== 'address,uint256,address') return `the SqkFaucet build at ${FAUCET} is not one claim per net night (constructor (${fc}))`;
  return false;
})();
const BASE_PORT = 18000 + (process.pid % 2000);
const START = 1793800000, OVER = 1793880000, N = 20761;                 // 4 Nov 13:46:40 UTC; 5 Nov 12:00 UTC = night 20761 is over
const OCT31 = 1793451600, N31 = 20757;                                  // 31 Oct 13:00 UTC: nets go to the 31 Oct night
const NOV1 = OCT31 + 86400, N01 = 20758;                                // 1 Nov 13:00 UTC: nets go to the 1 Nov night
const CENT = 10n ** 16n;                                                 // 0.01 test SQK: a net's cost and the faucet's drip
const pad = (x) => BigInt(x).toString(16).padStart(64, '0');
const word = (hex, i) => BigInt('0x' + hex.slice(2 + 64 * i, 66 + 64 * i));
const svgOf = (image) => Buffer.from(image.split(',')[1], 'base64').toString('utf8');
// the wallet methods the page needs (as in catch.test.mjs): anything else is a test failure
const ALLOWED = new Set(['eth_requestAccounts', 'eth_accounts', 'eth_chainId', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'eth_call', 'eth_getBalance', 'eth_getBlockByNumber', 'eth_sendTransaction', 'eth_getTransactionReceipt', 'eth_signTypedData_v4']);
const opts = (t, steps, extra) => ({ now: () => t * 1000, pollMs: 30, ...(steps ? { onStep: (s) => steps.push(s) } : {}), ...extra });
const signsAndSends = (w) => w.log.filter((m) => m === 'eth_signTypedData_v4' || m === 'eth_sendTransaction');

// one local anvil (chain id 11155111) and the helpers on it
async function startAnvil(port, timestamp) {
  const url = `http://127.0.0.1:${port}`;
  const proc = spawn(ANVIL, ['--host', '127.0.0.1', '--port', String(port), '--chain-id', '11155111', '--timestamp', String(timestamp), '--silent', '--max-persisted-states', '0'], { stdio: 'ignore' });
  let id = 0;
  const rpc = async (method, params = []) => {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch (e) { if (i > 100) { proc.kill('SIGTERM'); throw e; } await new Promise((r) => setTimeout(r, 100)); } }
  assert.equal(await rpc('eth_chainId'), '0xaa36a7', 'local anvil posing as Sepolia');
  const receipt = async (h) => { for (let i = 0; i < 100; i++) { const r = await rpc('eth_getTransactionReceipt', [h]); if (r) return r; await new Promise((s) => setTimeout(s, 50)); } throw new Error('no receipt'); };
  const tx = async (from, to, data) => receipt(await rpc('eth_sendTransaction', [{ from, to, data }]));
  const call = (to, data, from) => rpc('eth_call', [{ to, data, ...(from ? { from } : {}) }, 'latest']);
  const reverted = (to, data, from) => call(to, data, from).then(() => null, (e) => e);
  const deploy = async (from, file, args = '') => {
    const code = load(file).bytecode.object;
    assert.ok(!code.includes('__$'), 'no unlinked libraries');
    const rc = await receipt(await rpc('eth_sendTransaction', [{ from, data: code + args, gas: '0x1c9c380' }]));
    assert.equal(rc.status, '0x1', `the deploy of ${path.basename(file)} failed`);
    return rc.contractAddress.toLowerCase();
  };
  const at = async (t) => { await rpc('evm_setNextBlockTimestamp', [t]); await rpc('evm_mine'); };
  // any address can cast on local anvil: impersonated, with test ETH for the fee
  const impersonate = async (a) => { await rpc('anvil_impersonateAccount', [a]); await rpc('anvil_setBalance', [a, '0x56bc75e2d63100000']); };
  // what a browser wallet does for the page: its own account, Sepolia already selected, everything else to the node.
  // o.sign: 'unsupported' (a wallet without typed-data signing) | 'reject' (the person says no)
  const wallet = (account, o = {}) => ({
    log: [], sent: [],
    async request({ method, params }) {
      this.log.push(method);
      assert.ok(ALLOWED.has(method), `the page never asks the wallet for ${method}`);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null;
      if (method === 'eth_signTypedData_v4' && o.sign === 'unsupported') throw Object.assign(new Error('The requested method is not supported by this Ethereum provider.'), { code: 4200 });
      if (method === 'eth_signTypedData_v4' && o.sign === 'reject') throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
      if (method === 'eth_sendTransaction') this.sent.push(params[0]);
      return rpc(method, params || []);
    },
  });
  const accounts = (await rpc('eth_accounts')).map((a) => a.toLowerCase());
  return { url, rpc, receipt, tx, call, reverted, deploy, at, impersonate, wallet, accounts, stop: () => proc.kill('SIGTERM') };
}

// the night as the poster sends it (post_night.mjs): landings per SPOT (the ring turn applied), his total turns, the steps,
// the spot of the chip's very first shot (shots_in_order[0], turned), the IBM job id (ASCII, zero-padded) and the sha256 of
// the result file
const nightOf = (f) => { const R = JSON.parse(fs.readFileSync(f, 'utf8')), T = QW.ringTurn(R.rounds.map((r) => r[1]));
  return { R, perSpot: QW.turned(R.counts, T), turns: R.rounds.reduce((a, r) => a + r[1], 0), steps: R.steps.length, first: QW.spotOf(R.shots_in_order[0], T),
    job: Buffer.from(R.job_id, 'ascii').toString('hex').padEnd(64, '0'), sha: crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') }; };
const recOf = (x) => ({ counts: x.perSpot, shots: x.R.wheel_shots, turns: x.turns, steps: x.steps, firstShot: x.first });

// the game's own selectors (forge's methodIdentifiers), the mock token's, and the hand-encoded calls the test makes itself
function abiOf() {
  const ids = load(OUT).methodIdentifiers, mids = load(MOCK).methodIdentifiers, fids = load(FAUCET).methodIdentifiers;
  const q = (sig) => '0x' + ids[sig], m = (sig) => '0x' + mids[sig], f = (sig) => '0x' + fids[sig];
  const strip = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
  const id1 = (sig) => (id) => q(sig) + strip(id);
  return {
    post: (n, x) => q(POST_SIG) + pad(n) + x.perSpot.map(pad).join('') + pad(x.turns) + pad(x.steps) + x.job + x.sha + pad(x.first),
    draw: (n, x, id) => q(DRAW_SIG) + pad(n) + x.sha + x.job + strip(id) + x.perSpot.map(pad).join(''),
    spotOf: id1('spotOf(uint256)'), reachOf: id1('reachOf(uint256)'), traitsOf: id1('traitsOf(uint256)'), burn: id1('burn(uint256)'), ownerOf: id1('ownerOf(uint256)'),
    balanceOf: (a) => q('balanceOf(address)') + pad(a), approveNft: (to, id) => q('approve(address,uint256)') + pad(to) + strip(id),
    mint: (to, v) => m('mint(address,uint256)') + pad(to) + pad(v), transfer: (to, v) => m('transfer(address,uint256)') + pad(to) + pad(v),
    totalSupply: m('totalSupply()'), totalBurned: m('totalBurned()'),
    lastClaimNight: (a) => f('lastClaimNight(address)') + pad(a),
    // traitsOf -> (night, posted, caught, spot, hat, glasses, scarf, grin, tier)
    traits: (hex) => { const w = [...Array(9).keys()].map((i) => Number(word(hex, i)));
      return { night: w[0], posted: !!w[1], caught: !!w[2], spot: w[3], hat: !!w[4], glasses: !!w[5], scarf: !!w[6], grin: !!w[7], tier: w[8] }; },
  };
}

// a net read back after its night is posted (x: one of QC.myNets) = the page's own outcome on the DRAWN spot, and the
// contract's pure drawOf on the posted record (sha256, job id, the net's id, the counts) = result().spot = spotOf()
async function checkDrawn(ch, A, C, x, n, xn, label) {
  const o = QC.outcome(recOf(xn), x.spot);
  assert.ok(Number.isInteger(x.spot) && x.spot >= 0 && x.spot < 16, `${label}: a drawn spot after the post`);
  assert.equal(Number(BigInt(await ch.call(C, A.draw(n, xn, x.tokenId)))), x.spot, `${label}: result().spot = drawOf(the posted record)`);
  assert.equal(Number(BigInt(await ch.call(C, A.spotOf(x.tokenId)))), x.spot, `${label}: spotOf = result().spot`);
  assert.ok(x.hits > 0 && x.hits === xn.perSpot[x.spot], `${label}: the drawn spot's landings (a drawn shot always landed there)`);
  assert.deepEqual([x.status, x.hits, x.tier, x.shots, x.looks], [o.status, o.hits, o.tier, o.shots, o.status === 1 ? x.spot : 0], `${label}: page = contract`);
  assert.equal(Number(BigInt(await ch.call(C, A.reachOf(x.tokenId)))), o.reach, `${label}: same reach`);
  const caught = o.status === 1, s = x.spot;
  assert.deepEqual(A.traits(await ch.call(C, A.traitsOf(x.tokenId))), { night: n, posted: true, caught, spot: s, hat: caught && !!(s & 1), glasses: caught && !!(s & 2),
    scarf: caught && !!(s & 4), grin: caught && !!(s & 8), tier: caught ? o.tier : 0 }, `${label}: traitsOf = result()`);
  assert.equal(x.name, `Quantum Catch: night of ${QC.dayOf(n)}, spot ${s}`, `${label}: the name carries the drawn spot`);
  const svg = svgOf(x.image);
  assert.match(svg, /^<svg/);
  if (o.reach === 2) { assert.equal(x.status, 2); assert.equal(x.tier, 0); assert.match(svg, /OUT OF REACH/); }
  return o;
}

// a caster (any address: anvil impersonates it) whose net for night n draws `spot` once x is posted, found with the
// contract's own pure drawOf BEFORE the cast (only a test knows the sha256 and the job id before the chip runs)
let nextCaster = 1;
async function casterFor(ch, A, C, n, x, spot) {
  for (let k = 0; k < 50000; k++) {
    const a = '0x' + 'ca57' + (nextCaster++).toString(16).padStart(36, '0');
    if (Number(BigInt(await ch.call(C, A.draw(n, x, QC.netId(n, a))))) === spot) { await ch.impersonate(a); return a; }
  }
  throw new Error(`no caster draws spot ${spot}`);
}

test('free nets (SQK unset): castNet() with no spot through catch.js; 31 Oct one net drawn on each spot, 1 Nov Legendary, 4 Nov as drawn; result + spot + reach + traits + tokenURI = the page\'s outcome; burn', { skip }, async () => {
  const ch = await startAnvil(BASE_PORT, OCT31);
  try {
    const { rpc, call, tx, reverted, wallet, at } = ch;
    const [hatcher, p1, p2, p3, p4, deployer] = [ch.accounts[0], ch.accounts[1], ch.accounts[2], ch.accounts[3], ch.accounts[4], ch.accounts[9]];
    const C = await ch.deploy(deployer, OUT, pad(hatcher) + pad(0) + pad(0) + pad(0));   // (hatcher, no painted art, no SQK, NET_COST 0)
    const A = abiOf(), pub = QC.rpcCall(fetch, ch.url);
    assert.notEqual(await rpc('eth_getCode', [C, 'latest']), '0x', 'the contract has code');
    assert.equal(await QC.netCostOf(pub, C), 0n, 'NET_COST() = 0: free nets');
    assert.deepEqual(await QC.sqkInfo(pub, C, null, p1), { cost: 0n, sqk: null, balance: null, faucetLeft: null, drip: null, claimed: null }, 'free nets: no token to read');
    const x4 = nightOf(CHIP), x31 = nightOf(CHIP31), x01 = { ...nightOf(CHIP01) };
    assert.deepEqual(x4.perSpot, [27, 693, 22, 705, 25, 308, 19, 368, 18, 383, 18, 289, 12, 292, 13, 808]);
    assert.deepEqual([x31.first, x4.first, x01.first], [13, 15, 6], 'the real first shots, turned onto the ring');
    assert.equal(QW.tiers(x01.perSpot, x01.turns, x01.steps, x01.first)[14], 3, '1 Nov: spot 14 (151 of 4,000) is the Epic spot');
    x01.first = 14;                                                     // made up: the Epic spot hit by the first shot (local anvil only)

    // 31 Oct: one net drawn on each of the 16 spots, cast before 21:00 UTC that day: steps and ONE transaction, no token
    const oct = [];
    for (let s = 0; s < 16; s++) {
      const who = await casterFor(ch, A, C, N31, x31, s), steps = [], w = wallet(who);
      const r = await QC.castNetNft(w, C, opts(OCT31, steps));
      assert.deepEqual(r, { txHash: r.txHash, night: N31, day: '2026-10-31', tokenId: QC.netId(N31, who), catcher: who }, 'no spot in the answer: the chip draws it');
      assert.deepEqual(steps, ['connect', 'network', 'check', 'send', 'wait', 'done'], 'free nets: no token steps');
      assert.deepEqual(signsAndSends(w), ['eth_sendTransaction'], 'ONE transaction, no signature');
      assert.deepEqual(w.sent.map((t) => t.data), [QC.enc.castNet()], 'castNet() with no spot');
      oct.push(who);
    }
    // 1 Nov: a net drawn on its Epic spot 14 and one on a Common spot (6)
    await at(NOV1);
    const nov1 = [];
    for (const s of [14, 6]) { const who = await casterFor(ch, A, C, N01, x01, s); assert.equal((await QC.castNetNft(wallet(who), C, opts(NOV1))).night, N01); nov1.push([who, s]); }

    // 4 Nov: anvil's own accounts, whatever they draw
    await at(START);
    const cast = async (who) => QC.castNetNft(wallet(who), C, opts(START));
    const r1 = await cast(p1);
    assert.deepEqual(r1, { txHash: r1.txHash, night: N, day: '2026-11-04', tokenId: QC.netId(N, p1), catcher: p1 });
    assert.equal(await call(C, A.ownerOf(r1.tokenId)), '0x' + pad(p1), 'ownerOf(tokenId) = the caster');
    assert.deepEqual(await QC.readNet(QC.walletCall(wallet(p1)), C, r1.tokenId), { status: 0, night: N, spot: null, hits: 0, shots: 0, tier: 0, looks: 0 }, 'waiting for the chip: no spot yet');
    assert.equal(Number(BigInt(await call(C, A.spotOf(r1.tokenId)))), 255, 'spotOf = NO_SPOT before the post');
    assert.deepEqual(A.traits(await call(C, A.traitsOf(r1.tokenId))), { night: N, posted: false, caught: false, spot: 0, hat: false, glasses: false, scarf: false, grin: false, tier: 0 }, 'traitsOf before the post');
    // one per wallet per night: the page checks first and sends nothing; the contract's own revert is also put in plain words
    const w = wallet(p1);
    await assert.rejects(QC.castNetNft(w, C, opts(START)), (e) => e.code === 'already');
    assert.ok(!w.log.includes('eth_sendTransaction'));
    const rev = await reverted(C, QC.enc.castNet(), p1);
    assert.ok(rev && QC.isRevert(rev)); assert.match(QC.plainError(rev), /already has a net/);
    const waitMeta = QC.tokenMeta(QC.dec.string(await call(C, QC.enc.tokenURI(r1.tokenId))));
    assert.equal(waitMeta.name, 'Quantum Catch: night of 2026-11-04', 'waiting: no spot in the name'); assert.equal(waitMeta.attr.Spot, undefined, 'no Spot attribute yet');
    assert.match(waitMeta.image, /^data:image\/svg\+xml;base64,/);
    assert.match(svgOf(waitMeta.image), /its spot is drawn after the run/);
    assert.ok(waitMeta.description.startsWith('Sepolia test NFT, no value. '), waitMeta.description.slice(0, 60));
    for (const who of [p2, p3, p4]) await cast(who);

    // the nights are over: the hatcher posts the real 31 Oct and 4 Nov chip results, per SPOT, with the chip's first shot, as
    // post_night.mjs; 1 Nov with a MADE-UP first shot on its Epic spot 14 (its real first shot landed on 6)
    await at(OVER);
    const hev = await reverted(C, QC.enc.castNet(), hatcher);
    assert.ok(hev && QC.isRevert(hev), 'the hatcher is not a player');
    for (const [n, x] of [[N31, x31], [N01, x01], [N, x4]]) assert.equal((await tx(hatcher, C, A.post(n, x))).status, '0x1');

    // 31 Oct, a net drawn on every spot: the page's QC.outcome on the drawn spot = the contract's result(), reachOf(), traitsOf()
    let outLoud = 0;
    for (let s = 0; s < 16; s++) {
      const [x] = await QC.myNets(QC.walletCall(wallet(oct[s])), C, oct[s], [N31]);
      assert.equal(x.spot, s, `31 Oct: the net found for spot ${s} drew it`);
      const o = await checkDrawn(ch, A, C, x, N31, x31, `31 Oct spot ${s}`);
      if (o.reach === 2) { if (o.hits * 100 >= o.shots) outLoud++; } else assert.equal(x.status, 1, `31 Oct spot ${s} in reach: caught`);
    }
    assert.equal(outLoud, 8, 'all 8 out-of-reach spots of 31 Oct had 1 % or more of the landings, and none of them caught');
    const t31 = [...Array(16).keys()].map((s) => QC.outcome(recOf(x31), s).tier);
    assert.deepEqual([1, 2, 3, 4, 5].map((k) => t31.filter((v) => v === k).length), [4, 2, 1, 1, 0], '31 Oct on-chain: 4 Common, 2 Uncommon, 1 Rare, 1 Epic');
    assert.deepEqual([QC.outcome(recOf(x31), 0).hits, QC.outcome(recOf(x31), 0).status], [46, 2], 'the 46/4000 vector of the contract\'s own tests');

    // 1 Nov: the net drawn on the Epic spot hit by the (made-up) first shot is Legendary on the contract and on the page
    for (const [[who, s], tier] of [[nov1[0], 5], [nov1[1], 1]]) {
      const [x] = await QC.myNets(QC.walletCall(wallet(who)), C, who, [N01]);
      assert.equal(x.spot, s);
      await checkDrawn(ch, A, C, x, N01, x01, `1 Nov spot ${s}`);
      assert.equal(x.tier, tier, `1 Nov spot ${s}: tier ${tier}`);
    }

    // 4 Nov: each net as drawn, read back through result() (eth_call) and its on-chain picture through tokenURI()
    const drawn4 = [];
    for (const who of [p1, p2, p3, p4]) {
      const nets = await QC.myNets(QC.walletCall(wallet(who)), C, who, [N + 1, N, N - 1]);
      assert.equal(nets.length, 1, 'one net, on the 4 Nov night');
      assert.deepEqual([nets[0].night, nets[0].day, nets[0].shots], [N, '2026-11-04', 4000]);
      await checkDrawn(ch, A, C, nets[0], N, x4, `4 Nov ${who}`);
      drawn4.push(nets[0].spot);
    }
    console.log(`# 4 Nov: the four nets drew spots ${drawn4.join(', ')}`);

    // after the post, a new net goes to the open night (5 Nov) at chain time, and the page takes the night from the log
    const late = await QC.castNetNft(wallet(p1), C, opts(START));   // the viewer's clock is wrong on purpose
    assert.equal(late.night, N + 1); assert.equal(late.day, '2026-11-05'); assert.equal(late.tokenId, QC.netId(N + 1, p1));

    // burn (amendment 3): the holder burns its net; it is gone for good and its id can never be cast again that night
    const nftBal = async (a) => BigInt(await call(C, A.balanceOf(a)));
    const before = await nftBal(p1);
    const brc = await tx(p1, C, A.burn(late.tokenId));
    assert.equal(brc.status, '0x1');
    const tl = brc.logs.find((l) => l.address.toLowerCase() === C);
    assert.deepEqual([tl.topics[1], tl.topics[2], tl.topics[3]], ['0x' + pad(p1), '0x' + pad(0), late.tokenId], 'Transfer(holder, 0, id)');
    assert.equal(await nftBal(p1), before - 1n, 'a burned net no longer counts in balanceOf');
    assert.equal(await QC.readNet(pub, C, late.tokenId), null, 'a burned net reads as no net');
    assert.deepEqual((await QC.myNets(pub, C, p1, [N + 1, N])).map((x) => x.night), [N], 'myNets skips the burned net');
    const gone = await reverted(C, A.ownerOf(late.tokenId));
    assert.ok(gone && String(gone.data).startsWith(QC.ERR.NonexistentToken), 'ownerOf reverts NonexistentToken');
    const again = await reverted(C, QC.enc.castNet(), p1);
    assert.ok(again && QC.isRevert(again)); assert.match(QC.plainError(again), /already has a net/, 'AlreadyCast still holds after the burn');
    // the page after a burn (free nets): result() cannot see the burned net, the simulated castNet() can: 'already', and
    // no transaction goes out (no gas spent on a cast that can only revert)
    const wb = wallet(p1), nb = Number(await rpc('eth_getTransactionCount', [p1, 'latest']));
    await assert.rejects(QC.castNetNft(wb, C, opts(START)), (e) => e.code === 'already' && /already has a net/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(wb), [], 'simulated, refused: nothing sent');
    assert.equal(Number(await rpc('eth_getTransactionCount', [p1, 'latest'])), nb, 'no transaction from p1');
    // only the holder or an address it approved can burn: not another player, not the hatcher; an approved address can
    const id2 = QC.netId(N, p2);
    for (const who of [p3, hatcher]) assert.ok(await reverted(C, A.burn(id2), who), 'only the holder or an approved address can burn');
    assert.equal((await tx(p2, C, A.approveNft(p3, id2))).status, '0x1');
    assert.equal((await tx(p3, C, A.burn(id2))).status, '0x1', 'an approved address burns');
    assert.equal(await QC.readNet(pub, C, id2), null);
  } finally { ch.stop(); }
});

test('paid nets on local anvil: a mock test SQK (permit + burn) and the SqkFaucet; NO_SQK, the faucet once per net night, ONE signature + ONE castNetWithPermit burning exactly NET_COST, the approve fallback, an allowance in place, a no, another token, a burned net, the v1 contract', { skip }, async () => {
  const ch = await startAnvil(BASE_PORT + 1, START);
  try {
    const { rpc, call, tx, reverted, wallet, at } = ch;
    const [hatcher, w1, w2, w3, w4, deployer] = [ch.accounts[0], ch.accounts[1], ch.accounts[2], ch.accounts[3], ch.accounts[4], ch.accounts[9]];
    const SQK = await ch.deploy(deployer, MOCK), SQK2 = await ch.deploy(deployer, MOCK_ND);
    const C = await ch.deploy(deployer, OUT, pad(hatcher) + pad(0) + pad(SQK) + pad(CENT));      // (hatcher, no art, the mock SQK, 0.01)
    const C2 = await ch.deploy(deployer, OUT, pad(hatcher) + pad(0) + pad(SQK2) + pad(CENT));    // the same with a token without eip712Domain()
    const F = await ch.deploy(deployer, FAUCET, pad(SQK) + pad(CENT) + pad(C));                  // SqkFaucet(SQK, DRIP 0.01, the game)
    const A = abiOf(), pub = QC.rpcCall(fetch, ch.url);
    assert.equal((await tx(deployer, SQK, A.mint(F, 2n * CENT))).status, '0x1', 'the faucet holds two drips');
    const bal = async (t, a) => QC.dec.uint(await call(t, QC.enc.balanceOf(a)));
    const supply = async (t) => BigInt(await call(t, A.totalSupply)), burnedSum = async (t) => BigInt(await call(t, A.totalBurned));
    const lastClaim = async (a) => { const h = await call(F, A.lastClaimNight(a)); return [!!Number(word(h, 0)), Number(word(h, 1))]; };
    const info0 = { cost: CENT, sqk: SQK, balance: 0n, faucetLeft: 2n * CENT, drip: CENT, claimed: false };
    assert.deepEqual(await QC.sqkInfo(pub, C, F, w1), info0, 'sqkInfo over the public RPC');
    assert.deepEqual(await QC.sqkInfo(wallet(w1), C, F, w1), info0, 'sqkInfo through the wallet on Sepolia');

    // no test SQK: it stops before any signature or transaction and points to the faucet
    let steps = [], w = wallet(w1);
    await assert.rejects(QC.castNetNft(w, C, opts(START, steps, { sqk: SQK })), (e) => e.code === 'NO_SQK' && e.cost === CENT && e.balance === 0n
      && /costs 0\.01 test SQK \(it gets burned\).*faucet.*Nothing was sent/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), [], 'no signature, no transaction');
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check']);

    // the faucet: ONE claim() transaction, 0.01 test SQK; once per wallet per net night
    steps = []; w = wallet(w1);
    const got = await QC.claimFaucet(w, F, opts(START, steps));
    assert.deepEqual([got.to, got.amount], [w1, CENT]);
    assert.deepEqual(steps, ['connect', 'network', 'faucet', 'wait', 'done']);
    assert.deepEqual(w.sent.map((t) => [t.to, t.data]), [[F, QC.enc.claim()]], 'one claim() transaction');
    assert.equal(await bal(SQK, w1), CENT);
    assert.deepEqual(await lastClaim(w1), [true, N], 'claimed for the open net night');
    w = wallet(w1);
    await assert.rejects(QC.claimFaucet(w, F, opts(START)), (e) => e.code === 'claimed' && /already got today's free test SQK/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), [], 'the page asks canClaim first and sends nothing');
    const twice = await reverted(F, QC.enc.claim(), w1);
    assert.ok(twice); assert.match(QC.plainError(twice), /already got today's free test SQK/, 'the faucet\'s own AlreadyClaimedTonight in plain words');
    assert.equal((await QC.sqkInfo(pub, C, F, w1)).claimed, true);

    // the permit path: ONE signature (eth_signTypedData_v4, the domain from eip712Domain()) + ONE castNetWithPermit, exactly
    // NET_COST burned, the game keeps nothing
    const s0 = await supply(SQK), b0 = await burnedSum(SQK);
    steps = []; w = wallet(w1);
    const r1 = await QC.castNetNft(w, C, opts(START, steps, { sqk: SQK }));
    assert.deepEqual(r1, { txHash: r1.txHash, night: N, day: '2026-11-04', tokenId: QC.netId(N, w1), catcher: w1 });
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'send', 'wait', 'done']);
    assert.deepEqual(signsAndSends(w), ['eth_signTypedData_v4', 'eth_sendTransaction'], 'one signature, then one transaction');
    assert.deepEqual([w.sent[0].to, w.sent[0].data.slice(0, 10), (w.sent[0].data.length - 10) / 64], [C, QC.SEL.castNetWithPermit, 4], 'castNetWithPermit(deadline, v, r, s)');
    const rc1 = await rpc('eth_getTransactionReceipt', [r1.txHash]), L = rc1.logs;
    // the token's Approval (the permit), Transfer(caster -> game), Transfer(game -> 0x0) (the burn), then the game's Transfer,
    // NetCast, NetPaid. The token's Transfer has the same topic as the NFT's: the page tells them apart by the address
    assert.deepEqual(L.map((l) => l.address.toLowerCase()), [SQK, SQK, SQK, C, C, C], 'log order');
    assert.equal(L[1].topics[0], L[3].topics[0], 'ERC-20 and ERC-721 Transfer share topic0'); assert.notEqual(L[0].topics[0], L[1].topics[0]);
    assert.deepEqual([L[1].topics[1], L[1].topics[2], BigInt(L[1].data)], ['0x' + pad(w1), '0x' + pad(C), CENT], 'caster -> game, exactly the cost');
    assert.deepEqual([L[2].topics[1], L[2].topics[2], BigInt(L[2].data)], ['0x' + pad(C), '0x' + pad(0), CENT], 'game -> 0x0: burned');
    assert.deepEqual(QC.dec.netCast(L[4]), { night: N, catcher: w1, tokenId: r1.tokenId });
    assert.deepEqual(QC.dec.netPaid(L[5]), { night: N, catcher: w1, burned: CENT });
    assert.equal(await supply(SQK), s0 - CENT, 'totalSupply down by exactly NET_COST');
    assert.equal(await burnedSum(SQK), b0 + CENT, 'totalBurned up by exactly NET_COST');
    assert.deepEqual([await bal(SQK, w1), await bal(SQK, C), QC.dec.uint(await call(SQK, QC.enc.allowance(w1, C))), QC.dec.uint(await call(SQK, QC.enc.nonces(w1)))], [0n, 0n, 0n, 1n],
      'the caster paid, the game holds nothing, no allowance left, the permit used');
    w = wallet(w1);
    await assert.rejects(QC.castNetNft(w, C, opts(START)), (e) => e.code === 'already');
    assert.deepEqual(signsAndSends(w), []);

    // a wallet that cannot sign typed data: approve(the game, exactly 0.01) then castNet(), reported as sqk-approve
    await QC.claimFaucet(wallet(w2), F, opts(START));
    steps = []; w = wallet(w2, { sign: 'unsupported' });
    await QC.castNetNft(w, C, opts(START, steps));
    assert.deepEqual(steps, ['connect', 'network', 'check', 'sqk-check', 'sqk-sign', 'sqk-approve', 'send', 'wait', 'done']);
    assert.deepEqual(w.sent.map((t) => [t.to, t.data]), [[SQK, QC.enc.approve(C, CENT)], [C, QC.enc.castNet()]], 'approve exactly the cost, then castNet()');
    assert.deepEqual([await bal(SQK, w2), QC.dec.uint(await call(SQK, QC.enc.allowance(w2, C))), await burnedSum(SQK)], [0n, 0n, b0 + 2n * CENT]);

    // two drips handed out: the faucet is empty; the page says so before sending; anyone refills it with a plain transfer
    assert.equal((await QC.sqkInfo(pub, C, F, w3)).faucetLeft, 0n);
    w = wallet(w3);
    await assert.rejects(QC.claimFaucet(w, F, opts(START)), (e) => e.code === 'empty' && /faucet is empty/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), []);
    assert.match(QC.plainError(await reverted(F, QC.enc.claim(), w3)), /faucet is empty/, 'the faucet\'s own FaucetEmpty in plain words');
    await tx(deployer, SQK, A.mint(deployer, 100n * CENT));
    assert.equal((await tx(deployer, SQK, A.transfer(F, 10n * CENT))).status, '0x1', 'a plain transfer refills the faucet');
    assert.equal((await QC.claimFaucet(wallet(w3), F, opts(START))).amount, CENT);

    // a "no" in the wallet: nothing sent, the test SQK stays; a page set up for another token stops before any signature
    w = wallet(w3, { sign: 'reject' });
    await assert.rejects(QC.castNetNft(w, C, opts(START)), (e) => e.code === 4001 && /said no in your wallet\. Nothing was sent/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), ['eth_signTypedData_v4'], 'asked once, refused: no transaction');
    assert.equal(await bal(SQK, w3), CENT);
    w = wallet(w3);
    await assert.rejects(QC.castNetNft(w, C, opts(START, null, { sqk: SQK2 })), (e) => e.code === 'config' && /do not match/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), []);
    // an allowance already in place (w3 approved the game itself): plain castNet(), no signature
    await tx(w3, SQK, QC.enc.approve(C, CENT));
    w = wallet(w3);
    assert.equal((await QC.castNetNft(w, C, opts(START))).night, N);
    assert.deepEqual(signsAndSends(w), ['eth_sendTransaction']); assert.deepEqual(w.sent.map((t) => t.data), [QC.enc.castNet()]);
    assert.equal(await burnedSum(SQK), b0 + 3n * CENT);

    // a token without eip712Domain(): the permit domain from name() + version "1" + the chain id + the token
    await tx(deployer, SQK2, A.mint(w4, CENT));
    w = wallet(w4);
    const t0 = await supply(SQK2);
    assert.equal((await QC.castNetNft(w, C2, opts(START, null, { sqk: SQK2 }))).night, N);
    assert.deepEqual(signsAndSends(w), ['eth_signTypedData_v4', 'eth_sendTransaction']);
    assert.equal(w.sent[0].data.slice(0, 10), QC.SEL.castNetWithPermit);
    assert.deepEqual([await supply(SQK2), await bal(SQK2, w4), await bal(SQK2, C2)], [t0 - CENT, 0n, 0n], 'the permit built from name() worked: burned');

    // the live v1 contract has no NET_COST() (an empty revert) and takes a spot: refused before anything is signed or sent
    const V1 = '0x' + 'a1'.repeat(20);
    await rpc('anvil_setCode', [V1, '0x60006000fd']);                     // PUSH1 0 PUSH1 0 REVERT: every call reverts, no data
    w = wallet(w3);
    await assert.rejects(QC.castNetNft(w, V1, opts(START)), (e) => e.code === 'config' && /pick-a-spot/.test(QC.plainError(e)));
    assert.deepEqual(signsAndSends(w), []);
    assert.equal((await QC.sqkInfo(pub, V1, null, w3)).cost, 0n, 'read-only, an empty NET_COST() revert = free nets');

    // the next net night (from 21:00 UTC): the faucet opens again for the same wallet
    await at(QC.closeAt(N) + 1);
    assert.equal((await QC.sqkInfo(pub, C, F, w1)).claimed, false, 'a new net night: claim again');
    const t1 = QC.closeAt(N) + 1;
    assert.equal((await QC.claimFaucet(wallet(w1), F, opts(t1))).amount, CENT);
    assert.deepEqual(await lastClaim(w1), [true, N + 1]);
    // a burned net is gone for good and its id can never be cast again: w1 casts for 5 Nov (permit), burns it, gets test SQK
    // again; the page's simulated permit cast hits AlreadyCast and sends nothing (nothing burned)
    const r5 = await QC.castNetNft(wallet(w1), C, opts(t1));
    assert.equal(r5.night, N + 1);
    assert.equal((await tx(w1, C, A.burn(r5.tokenId))).status, '0x1');
    assert.equal(await QC.readNet(pub, C, r5.tokenId), null, 'burned');
    await tx(deployer, SQK, A.mint(w1, CENT));
    const b5 = await burnedSum(SQK);
    w = wallet(w1);
    await assert.rejects(QC.castNetNft(w, C, opts(t1)), (e) => e.code === 'already');
    assert.deepEqual(signsAndSends(w), ['eth_signTypedData_v4'], 'signed, simulated, refused: no transaction');
    assert.deepEqual([await bal(SQK, w1), await burnedSum(SQK)], [CENT, b5], 'nothing taken');
    // the same burned net with an allowance already in place (no permit to simulate): the plain castNet() is simulated
    // too, so it is refused the same way, with no signature and no transaction
    await tx(w1, SQK, QC.enc.approve(C, CENT));
    w = wallet(w1);
    await assert.rejects(QC.castNetNft(w, C, opts(t1)), (e) => e.code === 'already');
    assert.deepEqual(signsAndSends(w), [], 'allowance in place, burned net: simulated, refused, nothing sent');
    assert.deepEqual([await bal(SQK, w1), await burnedSum(SQK)], [CENT, b5], 'nothing taken');
    await tx(w1, SQK, QC.enc.approve(C, 0n));

    // paid nets resolve like free ones: post 4 Nov; each paid net's drawn spot + tier = the page's outcome
    await at(OVER);
    const x4 = nightOf(CHIP);
    assert.ok(await reverted(C, QC.enc.castNet(), hatcher), 'the hatcher cannot cast a net');
    assert.equal((await tx(hatcher, C, A.post(N, x4))).status, '0x1');
    for (const who of [w1, w2, w3]) {
      const [x] = await QC.myNets(pub, C, who, [N]);
      await checkDrawn(ch, A, C, x, N, x4, `paid 4 Nov ${who}`);
    }
    assert.equal(await bal(SQK, C), 0n, 'the game never holds test SQK');
  } finally { ch.stop(); }
});
