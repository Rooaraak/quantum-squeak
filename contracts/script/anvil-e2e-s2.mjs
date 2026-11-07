// Season 2 end-to-end on a LOCAL anvil (never a public network), with anvil's own unlocked test accounts (no key):
//   deploy: a mock test SQK (test/mocks/MockSqk.sol: burn + permit), the art chunks (art/s2/index.json), S2Directory, S2Text,
//           S2Renderer(directory, chunks, text), QuantumCatchV3(HATCHER, renderer, SQK, 0.01), SqkFaucet(SQK, 0.01, v3)
//           one transaction at a time (each under EIP-7825's 16,777,216 gas on anvil's pricing)
//   4 Nov (night 20761): 8 players claim from the faucet and cast with an EIP-2612 permit (one transaction each), 40
//           more nets are cast with approve + castNet; the REAL v1.2 chip result (IBM job dbmbr0hkbkrc73cp7u8g) is posted by
//           quantum/post_night.mjs's send() from the HATCHER, the nets read DRAWING, then quantum/seal_night.mjs seals it
//           (the seed is checked against the hash of the block after the post)
//   5 Nov (night 20762): 60 nets; a made-up golden night (the same counts, its first shot on the Epic spot) posted
//           straight from the HATCHER and sealed
//   every net: result / dnaOf / traitsOf against a JavaScript recomputation of the draw (keccak, walk, tiersOf), and
//           tokenURI decoded (JSON, SVG, every WebP); with the private reference (contracts/tools/pack_s2.py) present, each
//           tokenURI is compared with it byte for byte (sha256)
//   then: setRenderer to a mock renderer (pictures change, every draw stays), back, lock (setRenderer reverts), a burn
// Writes report.json and a few cards (svg) to outDir.
//   node contracts/script/anvil-e2e-s2.mjs [outDir]     (PORT=8547 by default)
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

const C = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'); // contracts/
const ROOT = path.join(C, '..');
const { loadWheel, send, tiersOf } = await import(path.join(ROOT, 'quantum/post_night.mjs'));
const { sealNight, checkSeal, unsealedNights } = await import(path.join(ROOT, 'quantum/seal_night.mjs'));
const HISTORY = '0x0000F90827F1C53a10cb7A02335B175320002935'; // EIP-2935 (block hashes, last 8191 blocks)
const PORT = Number(process.env.PORT || 8547);
const RPC = `http://127.0.0.1:${PORT}`;
const F = process.env.FOUNDRY_BIN || `${process.env.HOME}/.foundry/bin`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'qc-s2-e2e-'));
fs.mkdirSync(OUT, { recursive: true });
const JOB = 'dbmbr0hkbkrc73cp7u8g';
const FILE = path.join(ROOT, `quantum/wheel-2026-11-04-ibm_marrakesh-${JOB}.json`);
const DAY = 86400, start = (n) => n * DAY + 43200;
const N = 20761, N2 = 20762;
const T0 = start(N) + 3600; // 4 Nov 13:00 UTC
const NET_COST = 10n ** 16n;
const CALL_CAP = 16_762_214; // the lowest measured eth_call gas cap (publicnode, tenderly, Alchemy)
const REF = path.join(C, 'tools/pack_s2.py'); // private (not exported): compared when present

const art = (file, name = path.basename(file, '.sol')) => JSON.parse(fs.readFileSync(path.join(C, 'out', `${file}`, `${name}.json`), 'utf8'));
const QC_ABI = art('QuantumCatchV3.sol').abi;
const R_ABI = art('S2Renderer.sol').abi;
const meta = (uri) => JSON.parse(Buffer.from(uri.slice(uri.indexOf(',') + 1), 'base64').toString('utf8'));
const svgOf = (m) => Buffer.from(m.image.slice(m.image.indexOf(',') + 1), 'base64').toString('utf8');
const trait = (m, k) => m.attributes.find((a) => a.trait_type === k)?.value;
const abi = ethers.AbiCoder.defaultAbiCoder();

const anvil = spawn(`${F}/anvil`, ['--host', '127.0.0.1', '--port', String(PORT), '--timestamp', String(T0), '--silent'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGTERM'); } catch {} };
process.on('exit', stop);
const report = { anvil: { port: PORT, chainId: 31337 }, deploy: { transactions: [] }, nights: {}, checks: [] };
const ok = (what) => { report.checks.push(what); console.log('  ok', what); };
try {
  const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true, cacheTimeout: -1, pollingInterval: 100 });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.equal(await provider.send('eth_chainId', []), '0x7a69', 'local anvil only');
  // one second per block, whatever the wall clock: the same block hashes (so the same seeds and draws) on every run
  await provider.send('anvil_setBlockTimestampInterval', [1]);
  const acc = await provider.send('eth_accounts', []);
  const [hatcher, deployer] = [acc[0], acc[9]];
  const players = acc.slice(1, 9);
  const signer = (a) => new ethers.JsonRpcSigner(provider, ethers.getAddress(a));
  const at = async (t) => { await provider.send('evm_setNextBlockTimestamp', [t]); await provider.send('evm_mine', []); };
  const dsigner = signer(deployer);

  // ---- deploy, one transaction at a time
  const deploy = async (file, args = [], name) => {
    const a = art(file, name);
    const f = new ethers.ContractFactory(a.abi, a.bytecode.object, dsigner);
    const c = await f.deploy(...args);
    const rc = await c.deploymentTransaction().wait();
    assert.equal(rc.status, 1);
    const gas = Number(rc.gasUsed);
    assert.ok(gas < 16_777_216, `${name || file} under the EIP-7825 cap`);
    const address = await c.getAddress();
    report.deploy.transactions.push({ contract: name || path.basename(file, '.sol'), address, gasUsed: gas, runtimeBytes: (await provider.getCode(address)).length / 2 - 1 });
    return new ethers.Contract(address, a.abi, dsigner);
  };
  const sqk = await deploy('MockSqk.sol');
  const sqkAddr = await sqk.getAddress();
  // the art chunks in stream order, as the packer listed them (contracts/art/s2/index.json)
  const index = JSON.parse(fs.readFileSync(path.join(C, 'art/s2/index.json'), 'utf8'));
  const chunks = [];
  for (const c of index.chunks) chunks.push(await (await deploy(`${c.contract}.sol`)).getAddress());
  const dir = await deploy('S2Directory.sol');
  const text = await deploy('S2Text.sol');
  const renderer = await deploy('S2Renderer.sol', [await dir.getAddress(), chunks, await text.getAddress()]);
  const qcW = await deploy('QuantumCatchV3.sol', [hatcher, await renderer.getAddress(), sqkAddr, NET_COST]);
  const addr = await qcW.getAddress();
  const faucet = await deploy('SqkFaucet.sol', [sqkAddr, NET_COST, addr]);
  const qc = new ethers.Contract(addr, QC_ABI, provider);
  const R = new ethers.Contract(await renderer.getAddress(), R_ABI, provider);
  const txs = report.deploy.transactions;
  report.deploy.totalGasAnvil = txs.reduce((a, t) => a + t.gasUsed, 0);
  report.deploy.deployedBytes = txs.reduce((a, t) => a + t.runtimeBytes, 0);
  Object.assign(report.deploy, { QuantumCatchV3: addr, S2Renderer: await R.getAddress(), S2Directory: await dir.getAddress(), S2Text: await text.getAddress(), SqkFaucet: await faucet.getAddress(), SQK: sqkAddr, HATCHER: hatcher, owner: deployer, chunks: chunks.length });
  console.log(`deployed ${txs.length} contracts (${chunks.length} chunks): ${report.deploy.deployedBytes.toLocaleString()} bytes of code, ${report.deploy.totalGasAnvil.toLocaleString()} gas on anvil's pricing`);
  assert.equal(await qc.owner(), ethers.getAddress(deployer));
  assert.equal(await qc.renderer(), await R.getAddress());
  assert.deepEqual((await R.chunks()).map((a) => a.toLowerCase()), chunks.map((a) => a.toLowerCase()));
  ok('deployed and wired (owner = deployer, renderer, chunks in order)');

  // ---- 4 Nov: 8 faucet + permit casts, 40 approve casts
  await (await sqk.mint(await faucet.getAddress(), 10n ** 20n)).wait();
  const net = {};
  const domain = { name: 'Squeek', version: '1', chainId: 31337, verifyingContract: sqkAddr };
  const types = { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] };
  for (const p of players) {
    const s = signer(p);
    await (await faucet.connect(s).claim()).wait();
    const deadline = T0 + 3600;
    const sig = ethers.Signature.from(await s.signTypedData(domain, types, { owner: s.address, spender: addr, value: NET_COST, nonce: await sqk.nonces(p), deadline }));
    const rc = await (await qc.connect(s).castNetWithPermit(deadline, sig.v, sig.r, sig.s)).wait();
    assert.equal(rc.status, 1);
    net[p] = BigInt(await qc.netId(N, p));
    assert.equal(await sqk.allowance(p, addr), 0n);
  }
  ok('8 players: faucet claim, then one-transaction permit casts (allowance used up)');
  const extra = async (n, count, base) => {
    const ids = [];
    for (let i = 0; i < count; i++) {
      const a = ethers.getAddress('0x' + (base + BigInt(i)).toString(16).padStart(40, '0'));
      await provider.send('anvil_setBalance', [a, '0xde0b6b3a7640000']);
      await provider.send('anvil_impersonateAccount', [a]);
      await (await sqk.mint(a, NET_COST)).wait();
      await (await sqk.connect(signer(a)).approve(addr, NET_COST)).wait();
      await (await qc.connect(signer(a)).castNet()).wait();
      ids.push(BigInt(await qc.netId(n, a)));
    }
    return ids;
  };
  const ids1 = [...Object.values(net), ...(await extra(N, 40, 0x5eedn << 144n))];
  ok(`${ids1.length} nets cast for night ${N}`);

  // ---- 4 Nov 21:00 on: 60 nets for 5 Nov
  await at(start(N) + 32400 + 60);
  assert.equal(Number(await qc.openNight()), N2);
  const ids2 = await extra(N2, 60, 0x5eed1n << 140n); // made-up casters (fresh addresses, never a real wallet)
  ok(`${ids2.length} nets cast for night ${N2}`);

  // ---- 5 Nov 12:00: post the real 4 Nov night (the poster), DRAWING until sealed, then seal
  await at(start(N + 1) + 600);
  const r = loadWheel(FILE, { job: JOB });
  const posted = await send(r, { contract: addr, signer: signer(hatcher) });
  assert.equal(posted.status, 1);
  {
    const res = await qc.result(ids1[0]);
    assert.equal(Number(res.status), 5, 'DRAWING until sealed');
    assert.equal(Number(res.spot), 255);
    const m = meta(await qc.tokenURI(ids1[0]));
    assert.equal(trait(m, 'Status'), 'Drawing');
    assert.match(svgOf(m), /DRAWING/);
    await assert.rejects(qc.connect(signer(players[0])).seal.staticCall(N), 'not before block postBlock + 2');
  }
  assert.deepEqual((await unsealedNights(provider, addr, N - 1, N2)).map((u) => u.night), [N], 'the sweep lists the posted, unsealed night');
  ok('posted by the poster; every net reads DRAWING; the seal refuses before postBlock + 2; the sweep lists it');
  await provider.send('evm_mine', []);
  await provider.send('evm_mine', []);
  const sealed1 = await sealNight(N, { contract: addr, signer: signer(players[3]), pollMs: 100 });
  assert.equal(sealed1.seedBlock, sealed1.postBlock + 1);
  assert.equal(sealed1.late, false);
  assert.deepEqual(await unsealedNights(provider, addr, N - 1, N2), [], 'sealed: the sweep is empty');
  ok(`sealed by a player at block ${sealed1.seedBlock} (= post + 1), seed = keccak256(blockhash, sha256, job) checked`);
  report.nights[N] = { post: { tx: posted.hash, gas: Number(posted.gasUsed) }, seal: { tx: sealed1.hash, gas: Number(sealed1.gasUsed), seedBlock: sealed1.seedBlock, seed: sealed1.seed } };

  // ---- 6 Nov 12:00: the made-up golden 5 Nov night
  await at(start(N2 + 1) + 600);
  const t4 = tiersOf(r.counts, r.turns, r.steps, r.firstShot).tiers;
  const epic = t4.indexOf(4);
  const job2 = ethers.encodeBytes32String('made-up-local-golden');
  const sha2 = ethers.keccak256(ethers.toUtf8Bytes('made up for the local test'));
  const rc2 = await (await qc.connect(signer(hatcher)).postNight(N2, r.counts, r.turns, r.steps, job2, sha2, epic)).wait();
  // sealed LATE: 300 blocks after the post (the hash of P + 1 is gone from BLOCKHASH): with the EIP-2935 history on this
  // chain the seal still uses P + 1's hash (the in-time seed), without it the newest 256-block boundary P + 257
  await provider.send('anvil_mine', ['0x12c']);
  const history = (await provider.getCode(HISTORY)) !== '0x';
  const sealed2 = await sealNight(N2, { contract: addr, signer: signer(players[5]), pollMs: 100 });
  const P2 = Number(rc2.blockNumber);
  assert.equal(sealed2.seedBlock, history ? P2 + 1 : P2 + 257, 'the late seal source');
  report.nights[N2] = { post: { gas: Number(rc2.gasUsed) }, seal: { gas: Number(sealed2.gasUsed), seedBlock: sealed2.seedBlock, seed: sealed2.seed, lateBy: 300, history }, firstShot: epic };
  ok(`golden night ${N2} posted (first shot on the Epic spot ${epic}) and sealed 300 blocks late: ${history ? 'block P + 1 from the EIP-2935 history (the in-time seed)' : 'no EIP-2935 here: the 256-block boundary P + 257'}`);

  // ---- every net: the draw recomputed here, the views, the card
  const walk = (counts, x) => { for (let s = 0; s < 16; s++) { if (x < BigInt(counts[s])) return s; x -= BigInt(counts[s]); } throw new Error('walk'); };
  const shots = r.counts.reduce((a, b) => a + b, 0);
  const byTier = [0, 0, 0, 0, 0, 0];
  const cards = [];
  const nights = [[N, ids1, sealed1.seed, r.firstShot, r.jobId, r.resultSha256, sealed1.seedBlock], [N2, ids2, sealed2.seed, epic, job2, sha2, sealed2.seedBlock]];
  let maxGas = 0, maxLen = 0;
  for (const [n, ids, seed, first, job, sha, seedBlock] of nights) {
    const tiers = tiersOf(r.counts, r.turns, r.steps, first).tiers;
    for (const id of ids) {
      const w0 = BigInt(ethers.keccak256(abi.encode(['uint32', 'bytes32', 'uint256'], [n, seed, id])));
      const spot = walk(r.counts, w0 % BigInt(shots));
      const res = await qc.result(id);
      assert.equal(Number(res.spot), spot, 'the main draw');
      assert.equal(Number(res.tier), tiers[spot]);
      assert.equal(Number(res.status), tiers[spot] ? 1 : 2);
      const d = await qc.dnaOf(id);
      if (tiers[spot]) {
        assert.equal(d.word, ethers.toBeHex(w0, 32));
        for (let k = 1; k <= 10; k++) {
          const wk = BigInt(ethers.keccak256(abi.encode(['uint32', 'bytes32', 'uint256', 'uint256'], [n, seed, id, k])));
          const sk = walk(r.counts, wk % BigInt(shots));
          assert.equal(Number(d.landings[k - 1]), Number(wk % BigInt(shots)));
          assert.equal(Number(d.tiers[k - 1]), tiers[sk]);
        }
      }
      byTier[tiers[spot]]++;
      const gas = Number(await provider.estimateGas({ to: addr, data: qc.interface.encodeFunctionData('tokenURI', [id]) }));
      const uri = await provider.call({ to: addr, data: qc.interface.encodeFunctionData('tokenURI', [id]), gasLimit: CALL_CAP }).then((x) => qc.interface.decodeFunctionResult('tokenURI', x)[0]);
      maxGas = Math.max(maxGas, gas); maxLen = Math.max(maxLen, uri.length);
      const m = meta(uri);
      const svg = svgOf(m);
      assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'));
      for (const h of svg.matchAll(/href='data:image\/webp;base64,([^']*)'/g)) assert.equal(Buffer.from(h[1], 'base64').subarray(8, 12).toString(), 'WEBP');
      if (tiers[spot]) {
        const t = await qc.traitsOf(id);
        const [skin, items] = await R.itemsOf({ status: d.status, tier: d.tier, spot: d.spot, shots: d.shots, word: d.word,
          tiers: [...d.tiers], spots: [...d.spots], landings: [...d.landings], words: [...d.words] });
        assert.equal(Number(t.skin), Number(skin));
        assert.equal(trait(m, 'Skin'), await R.skinName(skin));
        const slots = ['Face', 'Head', 'Eyes', 'Mouth', 'Neck', 'Hands', 'Back', 'Special', 'Aura', 'Background'];
        for (let k = 0; k < 10; k++) assert.equal(trait(m, slots[k]), await R.traitName(k + 1, items[k]));
        assert.equal(trait(m, 'Traits worn'), items.filter((x) => Number(x) !== 0).length);
        assert.equal(trait(m, 'Seal block'), String(seedBlock));
      }
      cards.push({ n, id, uri, tier: tiers[spot] });
    }
  }
  report.tokens = { byTier, maxTokenURIGas: maxGas, maxTokenURIBytes: maxLen };
  ok(`${ids1.length + ids2.length} nets: draws recomputed, views agree, every card decodes (tiers none..Legendary: ${byTier.join(' / ')}; max tokenURI ${maxLen.toLocaleString()} bytes, ${maxGas.toLocaleString()} gas)`);
  assert.ok(byTier[1] && byTier[2] && byTier[3] && byTier[4] && byTier[5], 'every tier caught at least once');

  // ---- the page's own reader (wheel/catch.js) on the deployed v3: result + dnaOf decoded by hand = ethers' decoding
  {
    const require_ = (await import('node:module')).createRequire(import.meta.url);
    const QC = require_(path.join(ROOT, 'wheel/catch.js'));
    const call = (to, data) => provider.call({ to, data });
    let caughtSeen = 0;
    for (const id of ids1.slice(0, 16)) {
      const r1 = await QC.readNet(call, addr, '0x' + id.toString(16).padStart(64, '0'), { dna: true });
      const res = await qc.result(id);
      assert.equal(r1.status, Number(res.status));
      assert.equal(r1.tier, Number(res.tier));
      if (r1.status === 1) {
        caughtSeen++;
        const d = await qc.dnaOf(id);
        assert.equal(r1.dna.word, d.word);
        assert.deepEqual(r1.dna.landings, [...d.landings].map(Number));
        assert.deepEqual(r1.dna.words, [...d.words]);
        assert.deepEqual(r1.dna.tiers, [...d.tiers].map(Number));
      }
    }
    assert.ok(caughtSeen > 0);
    const mine = await QC.myNets(call, addr, players[1], [N2, N], { dna: true });
    assert.equal(mine.length, 1);
    assert.ok(mine[0].image.startsWith('data:image/svg+xml;base64,'));
    ok(`wheel/catch.js reads v3: readNet (+ dnaOf by hand) = the contract for 16 nets, myNets with the on-chain image`);
  }

  // ---- byte for byte with the reference (private tool, when present)
  if (fs.existsSync(REF)) {
    let same = 0;
    for (const [n, ids, seed, first, job, sha, seedBlock] of nights) {
      const q = { n, counts: r.counts, turns: r.turns, steps: r.steps, first, job, sha, seedBlock, seed, tokens: ids.map(String) };
      const ref = JSON.parse(execFileSync('python3', [REF, '--uri'], { input: JSON.stringify(q), encoding: 'utf8', maxBuffer: 1 << 26 }));
      for (const x of ref) {
        const c = cards.find((y) => y.n === n && y.id === BigInt(x.token));
        assert.equal(Buffer.byteLength(c.uri), x.length, `length of ${x.token}`);
        assert.equal('0x' + crypto.createHash('sha256').update(c.uri).digest('hex'), x.sha256, `bytes of ${x.token}`);
        same++;
      }
    }
    report.referenceMatches = same;
    ok(`all ${same} tokenURIs equal the reference byte for byte`);
  }
  for (const t of [1, 2, 3, 4, 5]) {
    const c = cards.find((x) => x.tier === t);
    if (c) fs.writeFileSync(path.join(OUT, `card-tier${t}.svg`), svgOf(meta(c.uri)));
  }

  // ---- the owner: swap the renderer (pictures change, draws stay), back, lock
  const fair = async (id) => JSON.stringify([await qc.result(id), await qc.dnaOf(id), await qc.reachOf(id)], (k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const sample = [...ids1.slice(0, 6), ...ids2.slice(0, 6)];
  const before = await Promise.all(sample.map(fair));
  const mock = await deploy('V3Base.t.sol', ['swap test'], 'MockRenderer');
  const owner = qc.connect(dsigner);
  await assert.rejects(qc.connect(signer(players[0])).setRenderer.staticCall(await mock.getAddress()), 'a stranger cannot set the renderer');
  await (await owner.setRenderer(await mock.getAddress())).wait();
  assert.match(await qc.tokenURI(sample[0]), /^swap test:/);
  assert.deepEqual(await Promise.all(sample.map(fair)), before);
  await (await owner.setRenderer(await R.getAddress())).wait();
  assert.equal(await qc.tokenURI(sample[0]), cards.find((c) => c.id === sample[0]).uri);
  await (await owner.lock()).wait();
  assert.equal(await qc.locked(), true);
  assert.equal(await qc.owner(), ethers.ZeroAddress);
  await assert.rejects(owner.setRenderer.staticCall(await mock.getAddress()), 'locked: no renderer change');
  assert.deepEqual(await Promise.all(sample.map(fair)), before);
  ok('setRenderer: pictures changed, every draw the same; back; lock: setRenderer reverts for good');

  // ---- a burn
  const holder = players[0];
  await (await qc.connect(signer(holder)).burn(net[holder])).wait();
  await assert.rejects(qc.tokenURI(net[holder]));
  ok('a holder burns its net: it is gone');
  report.ok = true;
} finally {
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1) + '\n');
  console.log('report:', path.join(OUT, 'report.json'));
  stop();
}
