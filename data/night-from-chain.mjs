// His night straight from the chain: SqueekCore.roundPage (cumulative work per ACTIVE round) for one Squeek day
// (D 12:00 UTC -> D+1 12:00 UTC). New core (since the 4 Nov redeploy) or the old one for earlier nights. Read-only.
//   node night-from-chain.mjs 2026-11-04 [more days...]  -> data/chain-nights.json (merged)
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
// ethers v6: ETHERS_PATH, else data/local.json {"ethers": "<path to ethers' lib.esm/index.js>"} (not in git), else the package
const local = (() => { try { return JSON.parse(fs.readFileSync(new URL('./local.json', import.meta.url), 'utf8')); } catch (e) { return {}; } })();
const spec = process.env.ETHERS_PATH || local.ethers || 'ethers';
const { ethers } = await import(spec.startsWith('/') ? pathToFileURL(spec).href : spec);
const CORES = [
  { address: '0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4', genesis: 1793735400 },   // new, since 4 Nov
  { address: '0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44', genesis: 1793022600 },   // old, stopped at round 1339
];
const ABI = ['function roundPage(uint64 afterRound, uint64 throughRound, uint256 maxRecords) view returns (tuple(uint64 certifiedThroughRound, tuple(uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) start, tuple(uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks) end, tuple(uint64 roundId, uint64 cumulativeWork, uint96 cumulativeBlockUnits, uint32 workPerThousandBlocks, bytes32 dataHash)[] rounds))',
  'function state() view returns (uint64,uint64,uint96,uint64,uint96,uint32,uint256,bool)'];
const p = new ethers.JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com', 11155111, { staticNetwork: true });
const OUT = new URL('./chain-nights.json', import.meta.url).pathname;
const all = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { source: 'SqueekCore.roundPage on Sepolia (active rounds only)', nights: {} };
for (const day of process.argv.slice(2)) {
  const t0 = Date.parse(day + 'T12:00:00Z') / 1000, t1 = t0 + 86400;
  const core = CORES.find((c) => t0 >= c.genesis) ;
  const c = new ethers.Contract(core.address, ABI, p);
  const settled = Number((await c.state())[0]);
  const first = Math.max(1, Math.floor((t0 - core.genesis) / 600) + 1), last = Math.floor((t1 - core.genesis) / 600);   // rounds starting inside the day
  const through = Math.min(last, settled);
  let after = first - 1, prev = null; const rounds = [];
  while (after < through) {
    const pg = await c.roundPage(after, through, 16);
    if (prev === null) prev = Number(pg.start.cumulativeWork);
    for (const r of pg.rounds) { const w = Number(r.cumulativeWork); rounds.push({ id: Number(r.roundId), turns: w - prev }); prev = w; }
    if (!pg.rounds.length) break;
    after = Number(pg.rounds[pg.rounds.length - 1].roundId);
    if (pg.rounds.length < 16) break;
  }
  all.nights[day] = { core: core.address, genesis: core.genesis, firstRound: first, lastRound: last, settledThrough: settled, complete: settled >= last, rounds };
  console.log(day, core.address.slice(0, 8), `rounds ${first}-${last}`, 'complete', settled >= last, 'active', rounds.length, 'turns', rounds.reduce((a, r) => a + r.turns, 0));
}
fs.writeFileSync(OUT, JSON.stringify(all, null, 1) + '\n');
