// Local-anvil end-to-end with the painted art (never a public network). Anvil starts at 3 Nov 13:00 UTC; deploy the
// whole game with script/DeployAll.s.sol (15 ArtChunk data contracts, PaintedArt, QuantumCatch(HATCHER, PaintedArt)), then:
//   3 Nov (night 20760), MADE UP for the local test only, posted straight from the HATCHER account: the 1 Nov v1.2
//     counts with spot 12 cut to 39 of 4000 (in reach, under 1 %: got away) and a made-up first shot on the Epic spot
//     0 (Legendary: the gold skin, no items);
//   4 Nov (night 20761), the REAL chip result of recipe v1.2 (IBM job dbmbr0hkbkrc73cp7u8g), posted by
//     quantum/post_night.mjs (GO=1 --anvil --job) with its real first shot (spot 3): nets on 15 Common, 3 Uncommon,
//     11 Rare, 7 Epic, and 0 / 6 out of reach (got away, chip noise);
//   5 Nov (night 20762): he slept, posted through the poster's own sleptNight() + send() (a scratch chain-nights record);
//   6 Nov (night 20763): never posted; past postDeadline its net reads "No chip result", and the poster refuses a late post.
// Every state is read back through result(), reachOf() and tokenURI() and checked; tokenURI is measured with
// eth_estimateGas and run as an eth_call capped at 30,000,000 gas. Writes to outDir: token-<state>.json (metadata),
// token-<state>.svg (the image), states.json (gas, sizes, addresses) for script/render-states.mjs (Chrome), and
// looks/caught-<looks>-<tier>.svg (every looks x tier 1..5 through the deployed renderer) for script/fallback-check.mjs.
//   node contracts/script/anvil-e2e.mjs [outDir]     (PORT=8546 by default)
// Uses only anvil's own unlocked test accounts.
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
const POSTER = path.join(ROOT, 'quantum/post_night.mjs');
const { sleptNight, send, tiersOf } = await import(POSTER);
const PORT = Number(process.env.PORT || 8546);
const RPC = `http://127.0.0.1:${PORT}`;
const F = process.env.FOUNDRY_BIN || `${process.env.HOME}/.foundry/bin`;
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'qc-e2e-'));
fs.mkdirSync(OUT, { recursive: true });
const JOB = 'dbmbr0hkbkrc73cp7u8g';
const FILE = path.join(ROOT, `quantum/wheel-2026-11-04-ibm_marrakesh-${JOB}.json`); // v1.2 (a v1 file of the night exists too)
const LATE = path.join(ROOT, 'quantum/wheel-2026-11-01-ibm_marrakesh-dbmbr2m74qds73ds11j0.json'); // v1.2, night 20758
const DAY = 86400, start = (n) => n * DAY + 43200;
const N3 = 20760, N = 20761, N5 = 20762, N6 = 20763;
const T0 = start(N3) + 3600; // 3 Nov 13:00 UTC
const START = 1793800000; // 4 Nov 13:46:40 UTC
const OVER = start(N + 1); // 5 Nov 12:00 UTC: the 4 Nov night is over
const SHA = '0x' + crypto.createHash('sha256').update(fs.readFileSync(FILE)).digest('hex');
const CAP = 30_000_000;
const ABI = [
  'function castNet(uint8 spot) returns (uint256)', 'function netId(uint32, address) pure returns (uint256)',
  'function openNight() view returns (uint32)', 'function HATCHER() view returns (address)', 'function ART() view returns (address)',
  'function RENDERER() view returns (address)',
  'function result(uint256) view returns (uint8 status, uint32 night, uint8 spot, uint16 hits, uint32 shots, uint8 tier, uint8 looks)',
  'function tokenURI(uint256) view returns (string)', 'function ownerOf(uint256) view returns (address)',
  'function reachOf(uint256) view returns (uint8)', 'function postDeadline(uint32) pure returns (uint256)',
  'function postNight(uint32 n, uint16[16] counts, uint32 turns, uint8 steps, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
  'function nightRecord(uint32 n) view returns (bool posted, uint16[16] counts, uint32 shots, uint32 turns, uint8 ringTurn, uint8 steps, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
  'function tiersOf(uint16[16] counts, uint32 turns, uint8 steps, uint8 firstShot) pure returns (uint8[16])',
];
const ART_ABI = ['function hamster(uint8 looks, uint8 tier) view returns (string)', 'function chunks() view returns (address[])'];
const meta = (uri) => JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
const svgOf = (m) => Buffer.from(m.image.split(',')[1], 'base64').toString('utf8');
const trait = (m, k) => m.attributes.find((a) => a.trait_type === k)?.value;
const PAINTED_AT = '<g id="painted" transform="translate(70.4 14.4) scale(.4)">';
const FALLBACK_AT = '<g id="fallback" transform="translate(84.7 89) scale(.48)">'; // the drawn hamster under it (no WebP)
const CARD = '(uint8 status,uint32 night,uint8 spot,uint16 hits,uint32 shots,uint8 tier,uint8 reach,uint8 steps,uint8 start,uint8 firstShot,uint8 rank,uint8 catchable,uint256 counts,bytes32 jobId,bytes32 sha)';
const RENDER_ABI = [`function tokenURI(${CARD} c, string painted) pure returns (string)`];

const anvil = spawn(`${F}/anvil`, ['--host', '127.0.0.1', '--port', String(PORT), '--timestamp', String(T0), '--silent'], { stdio: 'ignore' });
const stop = () => { try { anvil.kill('SIGTERM'); } catch {} };
process.on('exit', stop);
const report = { anvil: { port: PORT, chainId: 31337 }, deploy: {}, states: {} };
try {
  const provider = new ethers.JsonRpcProvider(RPC, 31337, { staticNetwork: true });
  for (let i = 0; ; i++) {
    try { await provider.getBlockNumber(); break; } catch { if (i > 100) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); }
  }
  assert.equal((await provider.send('eth_chainId', [])), '0x7a69', 'local anvil only');
  const acc = await provider.send('eth_accounts', []);
  const [hatcher, deployer] = [acc[0], acc[9]];
  const players = acc.slice(1, 9);
  const at = async (t) => { await provider.send('evm_setNextBlockTimestamp', [t]); await provider.send('evm_mine', []); };

  // ---- deploy everything with the one deploy script
  const blockNumber = async () => Number(await provider.send('eth_blockNumber', [])); // uncached (ethers caches 250 ms)
  const b0 = await blockNumber();
  // --slow: one transaction at a time, each waits for its receipt (anvil fits only 4 of the ~7M-gas chunk deploys in a
  // 30M block; sent all at once, the rest would wait in its pool for a block that automine never starts)
  const dep = execFileSync(`${F}/forge`, ['script', 'script/DeployAll.s.sol', '--offline', '--rpc-url', RPC, '--broadcast', '--slow', '--unlocked', '--sender', deployer],
    { cwd: C, env: { ...process.env, HATCHER: hatcher }, encoding: 'utf8' });
  const grab = (re) => re.exec(dep)?.[1] || assert.fail(`no ${re} in deploy output:\n${dep}`);
  const addr = grab(/QuantumCatch (0x[0-9a-fA-F]{40})/), artAddr = grab(/PaintedArt (0x[0-9a-fA-F]{40})/), renderer = grab(/RENDERER (0x[0-9a-fA-F]{40})/);
  const chunks = [...dep.matchAll(/ArtChunk (\d+) (0x[0-9a-fA-F]{40})/g)].map((m) => m[2]);
  assert.equal(chunks.length, 15, '15 ArtChunk data contracts');
  const txs = [];
  for (let b = b0 + 1, top = await blockNumber(); b <= top; b++) {
    const blk = await provider.getBlock(b);
    for (const h of blk.transactions) {
      const r = await provider.getTransactionReceipt(h);
      assert.equal(r.status, 1);
      txs.push({ contract: r.contractAddress, gasUsed: Number(r.gasUsed) });
    }
  }
  assert.equal(txs.length, 17, '17 deploy transactions: 15 chunks, PaintedArt, QuantumCatch (which creates its renderer)');
  const maxTx = Math.max(...txs.map((t) => t.gasUsed));
  assert.ok(maxTx < 16_777_216, `every deploy transaction under the EIP-7825 cap (max ${maxTx})`);
  report.deploy = { QuantumCatch: addr, PaintedArt: artAddr, RENDERER: renderer, HATCHER: hatcher, deployer, ArtChunks: chunks, transactions: txs,
    totalGas: txs.reduce((a, t) => a + t.gasUsed, 0), maxTxGas: maxTx,
    runtimeBytes: { QuantumCatch: (await provider.getCode(addr)).length / 2 - 1, RENDERER: (await provider.getCode(renderer)).length / 2 - 1, PaintedArt: (await provider.getCode(artAddr)).length / 2 - 1 } };
  console.log('deployed QuantumCatch', addr, '| PaintedArt', artAddr, '| renderer', renderer, '| hatcher', hatcher);
  console.log(`  ${txs.length} transactions, ${report.deploy.totalGas} gas in all, the largest ${maxTx}`);

  const qc = new ethers.Contract(addr, ABI, provider);
  const art = new ethers.Contract(artAddr, ART_ABI, provider);
  assert.equal(await qc.HATCHER(), ethers.getAddress(hatcher));
  assert.equal(await qc.ART(), ethers.getAddress(artAddr));
  assert.equal(await qc.RENDERER(), ethers.getAddress(renderer));
  assert.deepEqual((await art.chunks()).map((a) => a.toLowerCase()), chunks.map((a) => a.toLowerCase()));
  const cast = async (who, spot) => { await (await qc.connect(await provider.getSigner(who)).castNet(spot)).wait(); };

  // ---- read one net back fully: result, reach, tokenURI (gas: estimate + capped eth_call), metadata, image
  async function read(label, who, n, want) {
    const id = await qc.netId(n, who);
    const r = await qc.result(id);
    const reach = Number(await qc.reachOf(id));
    const data = qc.interface.encodeFunctionData('tokenURI', [id]);
    const gas = Number(await provider.estimateGas({ to: addr, data }));
    const raw = await provider.call({ to: addr, data, gasLimit: CAP }); // a wallet's eth_call, capped at 30M
    const uri = qc.interface.decodeFunctionResult('tokenURI', raw)[0];
    const m = meta(uri), svg = svgOf(m);
    assert.deepEqual([Number(r.status), Number(r.tier), reach, Number(r.night), Number(r.spot)], [want.status, want.tier, want.reach, n, want.spot], `${label}: result`);
    if (want.hits !== undefined) assert.equal(Number(r.hits), want.hits, `${label}: hits`);
    assert.equal(await qc.ownerOf(id), ethers.getAddress(who));
    assert.equal(trait(m, 'Status'), want.statusName, `${label}: Status`);
    assert.equal(trait(m, 'Tier'), want.tierName, `${label}: Tier`);
    assert.ok(m.description.startsWith('Free Sepolia test NFT, no value. '), label);
    assert.equal(svg.includes('id="painted"'), want.status === 1, `${label}: painted only when caught`);
    if (want.status === 1) {
      const frag = await art.hamster(want.spot, want.tier);
      assert.ok(svg.includes(PAINTED_AT + frag + '</g>'), `${label}: exactly PaintedArt's hamster(${want.spot}, ${want.tier})`);
      const fb = svg.indexOf(FALLBACK_AT + '<g id="hamster">'), at = svg.indexOf(PAINTED_AT);
      assert.ok(fb > 0 && fb < at && svg.slice(at - 4, at) === '</g>', `${label}: the drawn fallback right under the painted hamster`);
      assert.equal(svg.split('<g id="hamster">').length, 2, `${label}: one drawn hamster (the fallback)`);
    }
    assert.equal(svg.includes('id="outofreach"'), want.reach === 2, `${label}: the out of reach mark`);
    assert.ok(gas < CAP, `${label}: tokenURI eth_estimateGas ${gas} < ${CAP}`);
    fs.writeFileSync(path.join(OUT, `token-${label}.json`), JSON.stringify({ ...m, image: `(${m.image.length} chars, see token-${label}.svg)` }, null, 1));
    fs.writeFileSync(path.join(OUT, `token-${label}.svg`), svg);
    report.states[label] = { night: n, spot: want.spot, status: trait(m, 'Status'), tier: trait(m, 'Tier'), reach: trait(m, 'Reach'),
      landings: trait(m, 'Landings'), firstShot: trait(m, 'First shot'), tokenURIGas: gas, tokenURIBytes: uri.length, svgBytes: svg.length,
      note: m.description.slice(33, 140) };
    console.log(`${label.padEnd(24)} ${m.name} | ${trait(m, 'Status')} ${trait(m, 'Tier')} | gas ${gas} | tokenURI ${uri.length} B | svg ${svg.length} B`);
    return { m, svg };
  }
  const ST = { waiting: [0, 'Waiting for the chip'], caught: [1, 'Caught'], away: [2, 'Got away'], slept: [3, 'He slept'], none: [4, 'No chip result'] };
  const want = (st, spot, tier, reach, hits) => ({ status: ST[st][0], statusName: ST[st][1], spot, tier, reach, hits,
    tierName: ['None', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'][tier] });

  // ---- 3 Nov: three nets (the made-up night)
  assert.equal(Number(await qc.openNight()), N3);
  const [a3, b3, c3] = players;
  await cast(a3, 0); await cast(b3, 12); await cast(c3, 13);

  // ---- 4 Nov: six nets before the 21:00 lock; one read while waiting
  await at(START);
  assert.equal(Number(await qc.openNight()), N);
  const nets = [[players[0], 15], [players[1], 3], [players[2], 11], [players[3], 7], [players[4], 0], [players[5], 6]];
  for (const [who, spot] of nets) await cast(who, spot);
  await read('waiting', players[0], N, want('waiting', 15, 0, 0));
  // after the lock: nets go to 5 Nov (he will sleep)
  await at(start(N) + 32400 + 60);
  assert.equal(Number(await qc.openNight()), N5);
  await cast(players[6], 9); await cast(players[7], 2);

  // ---- 5 Nov noon: post 4 Nov (real, through the poster) and 3 Nov (made up, straight from the hatcher)
  await at(OVER);
  const post = (env, file = FILE, job = JOB) => execFileSync('node', [POSTER, file, '--job', job, '--contract', addr, '--rpc', RPC, '--anvil'],
    { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.throws(() => execFileSync('node', [POSTER, FILE], { stdio: 'pipe' }), /2 result files/, 'two files for 4 Nov: --job is required');
  const dry = post({ GO: '' });
  assert.match(dry, /DRY RUN/);
  assert.match(dry, /the chip's first shot: position 10 -> spot 3 \(not the Epic spot: no Legendary tonight\)/);
  const sent = post({ GO: '1' });
  console.log(sent.split('\n').filter((l) => /SENT|postNight\(|first shot/.test(l)).join('\n'));
  assert.match(sent, /SENT on local anvil: tx 0x[0-9a-f]{64} status 1/);
  assert.throws(() => post({ GO: '1' }), /already posted/, 'a second post is refused before sending');
  const rec = await qc.nightRecord(N);
  assert.equal(Number(rec.firstShot), 3, 'the real first shot, turned onto the ring');
  assert.equal(rec.resultSha256, SHA, 'the posted hash is the file\'s sha256');

  const c3n = [244, 30, 496, 52, 491, 53, 593 + 450, 48, 286, 16, 539, 52, 39, 47, 514, 50]; // made up from the 1 Nov v1.2 rerun
  assert.equal(c3n.reduce((x, y) => x + y, 0), 4000);
  const local = tiersOf(c3n, 8984, 10, 0).tiers;
  assert.deepEqual((await qc.tiersOf(c3n, 8984, 10, 0)).map(Number), local, 'the contract ranks the made-up night as the poster does');
  const hq = qc.connect(await provider.getSigner(hatcher));
  await (await hq.postNight(N3, c3n, 8984, 10, ethers.encodeBytes32String('made-up-local-test'), ethers.ZeroHash, 0)).wait();

  // ---- every state of the two ran nights
  const tiers4 = [0, 1, 0, 2, 0, 1, 0, 4, 0, 2, 0, 3, 0, 1, 0, 1]; // 4 Nov v1.2 with its real first shot (spot 3)
  const counts4 = [40, 679, 55, 493, 46, 504, 29, 254, 44, 380, 34, 260, 33, 578, 46, 525];
  const labels = { 15: 'caught-common', 3: 'caught-uncommon', 11: 'caught-rare', 7: 'caught-epic', 0: 'away-out-of-reach', 6: 'away-out-of-reach-6' };
  for (const [who, spot] of nets) {
    const caught = tiers4[spot] > 0;
    const { m } = await read(labels[spot], who, N, want(caught ? 'caught' : 'away', spot, tiers4[spot], spot % 2 ? 1 : 2, counts4[spot]));
    assert.equal(trait(m, 'IBM job'), JOB);
    assert.equal(trait(m, 'Result sha256'), SHA);
    assert.equal(trait(m, 'Steps'), 10);
    assert.equal(trait(m, 'First shot'), 'spot 3');
    assert.ok(m.description.includes('After its 10 steps a perfect walk can only land on spots of the right parity within 10 spots of his start (spot 9): those are the spots in reach tonight.'));
    if (spot === 7) assert.ok(m.description.includes('Caught: rank 8 of the 8 catchable spots tonight by landings, most first. A net'));
    if (spot === 0) assert.ok(m.description.includes('Out of reach tonight: he could not land here; the 40 landings here are the chip\'s noise.'));
  }
  const l = await read('caught-legendary', a3, N3, want('caught', 0, 5, 1, 244));
  assert.ok(l.m.description.includes('Caught: rank 7 of the 7 catchable spots tonight by landings, most first. The chip\'s very first shot of the night landed here.'));
  assert.equal(local[0], 5);
  await read('away-in-reach', b3, N3, want('away', 12, 0, 1, 39));
  await read('away-out-of-reach-13', c3, N3, want('away', 13, 0, 2, 47));

  // ---- 6 Nov noon: 5 Nov is over: he slept, posted by the poster's own code path (sleptNight + send)
  await at(start(N5 + 1));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-e2e-chain-'));
  try {
    const cn = path.join(scratch, 'chain-nights.json');
    fs.writeFileSync(cn, JSON.stringify({ nights: { '2026-11-05': { complete: true, rounds: [] } } }));
    const r5 = sleptNight('2026-11-05', { chainNights: cn });
    const out = await send(r5, { contract: addr, signer: await provider.getSigner(hatcher) });
    assert.equal(out.status, 1);
    console.log(`he slept on 5 Nov: posted by the poster, tx ${out.hash}`);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  const s = await read('slept', players[6], N5, want('slept', 9, 0, 0));
  assert.ok(s.svg.includes('HE SLEPT') && s.svg.includes('<g id="hamster">'), 'the drawn hamster, asleep');

  // ---- 6 Nov: a net that is never posted; past its 14-day window: No chip result; the poster refuses a late post
  await cast(players[0], 4);
  await read('waiting-6-nov', players[0], N6, want('waiting', 4, 0, 0));
  await at(Number(await qc.postDeadline(N6)));
  await read('no-chip-result', players[0], N6, want('none', 4, 0, 0));
  assert.throws(() => post({ GO: '1' }, LATE, 'dbmbr2m74qds73ds11j0'), /post window closed/, 'a late post is refused before sending');

  // ---- every looks x tier 1..5 through the deployed renderer (what tokenURI does for a caught net), for
  // script/fallback-check.mjs: looks/caught-<looks>-<tier>.svg
  const rnd = new ethers.Contract(renderer, RENDER_ABI, provider);
  fs.mkdirSync(path.join(OUT, 'looks'), { recursive: true });
  let most = 0;
  for (let looks = 0; looks < 16; looks++) {
    for (let tier = 1; tier <= 5; tier++) {
      const frag = await art.hamster(looks, tier);
      const card = [1, N, looks, 300, 4000, tier, 1, 10, 9, 3, 4, 8, 0n, ethers.ZeroHash, ethers.ZeroHash];
      const data = rnd.interface.encodeFunctionData('tokenURI', [card, frag]);
      const g = Number(await provider.estimateGas({ to: renderer, data }));
      most = Math.max(most, g);
      const uri = rnd.interface.decodeFunctionResult('tokenURI', await provider.call({ to: renderer, data, gasLimit: CAP }))[0];
      const svg = svgOf(meta(uri));
      assert.ok(svg.includes(FALLBACK_AT + '<g id="hamster">') && svg.includes('</g>' + PAINTED_AT + frag + '</g>'), `looks ${looks} tier ${tier}: fallback + painted`);
      fs.writeFileSync(path.join(OUT, 'looks', `caught-${looks}-${tier}.svg`), svg);
    }
  }
  report.everyLooks = { cards: 80, rendererMostGas: most };
  console.log(`every looks x tier 1..5: 80 caught cards from the renderer in looks/ (the most gas: ${most})`);

  const heavy = Object.entries(report.states).sort((x, y) => y[1].tokenURIGas - x[1].tokenURIGas)[0];
  report.heaviest = { state: heavy[0], gas: heavy[1].tokenURIGas, bytes: heavy[1].tokenURIBytes };
  fs.writeFileSync(path.join(OUT, 'states.json'), JSON.stringify(report, null, 1));
  console.log(`heaviest tokenURI: ${heavy[0]} ${heavy[1].tokenURIGas} gas, ${heavy[1].tokenURIBytes} bytes (cap ${CAP})`);
  console.log('E2E OK, files in', OUT);
} finally {
  stop();
}
