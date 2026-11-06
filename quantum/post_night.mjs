// Post one night's chip result to QuantumCatch.postNight. DRY BY DEFAULT: checks the file and prints the exact call.
//   node quantum/post_night.mjs quantum/wheel-2026-11-05-ibm_marrakesh-<job>.json [--job <job>] [--contract 0x..]
//   node quantum/post_night.mjs --slept 2026-11-06 [--contract 0x..]   he did not run (data/chain-nights.json says so)
//   GO=1 node quantum/post_night.mjs <file> --contract 0x.. --rpc <url>              -> needs the operator's signer (TODO)
//   GO=1 node quantum/post_night.mjs <file> --job <job> --contract 0x.. --rpc http://127.0.0.1:8546 --anvil
//        local anvil only: sends from the HATCHER account that anvil itself holds unlocked (no key anywhere)
// The first post of a night is permanent (no correction), so this FAILS CLOSED. It refuses:
//   - files under quantum/rejected/, and any file whose healthy !== true (or whose twin test is under the gate)
//   - a night that data/chain-nights.json does not list as complete, or whose core or rounds (ids and turns, in
//     order) differ from the file's: the chain record is the only independent check of his night
//   - a recipe other than the game's (GAME_RECIPE), or steps that do not follow from the chain rounds by that recipe
//   - a night with more than one wheel-<night>-*.json (outside rejected/), unless --job names the one to post
// Counts go on-chain per SPOT, turned by the ring turn of recipe v1.1: spot = (position + his total turns) % 16
// (wheel.py spot_of / ring_turn), with the walk's step count: a net on a spot out of reach that night never catches.
// With them goes the spot of the chip's very first shot (the file's shots_in_order[0], turned the same way): rarity is
// the rank among the night's catchable spots (QuantumCatch.tiersOf), and the Epic spot is Legendary when the first
// shot landed on it. A file without shots_in_order is refused (the first shot could not be posted).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

export const ABI = [
  'function postNight(uint32 n, uint16[16] counts, uint32 turns, uint8 steps, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
  'function nightRecord(uint32 n) view returns (bool posted, uint16[16] counts, uint32 shots, uint32 turns, uint8 ringTurn, uint8 steps, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
  'function tiersOf(uint16[16] counts, uint32 turns, uint8 steps, uint8 firstShot) pure returns (uint8[16] tiers)',
  'function nightOverAt(uint32 n) pure returns (uint256)',
  'function postDeadline(uint32 n) pure returns (uint256)',
  'function HATCHER() view returns (address)',
  'event NightPosted(uint32 indexed night, uint32 shots, uint32 turns, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
];
export const ALLOWED_CHAINS = { 31337n: 'local anvil', 11155111n: 'Sepolia' };
const HEALTH_MIN = 0.79; // wheel.py HEALTH_MIN: twin test (CHSH) gate
/** The recipe the game runs (wheel.py RECIPE, wheel_spec.md) and its step cap (wheel.py CAP). Archive files of older
 *  recipes are refused: a night is posted once and for good, with the game's recipe only. */
export const GAME_RECIPE = 'wheel_spec.md v1.2';
const STEP_CAP = 10;
export const TIER_NAMES = [null, 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary']; // tier codes 0..5, as the contract
const NAME = /^wheel-(\d{4}-\d{2}-\d{2})-([a-z0-9_]+)-([A-Za-z0-9._-]+)\.json$/;
const JOB = /^[A-Za-z0-9._-]{1,31}$/;
const here = path.dirname(fileURLToPath(import.meta.url));

const fail = (m) => { throw new Error(m); };
const isUint = (x, max) => Number.isInteger(x) && x >= 0 && x <= max;

/** Squeek night number of a 'YYYY-MM-DD' (the day its 12:00 UTC start falls on): days since 1970-01-01. */
export function nightNumber(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) || fail(`bad date ${date}`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (new Date(ms).toISOString().slice(0, 10) !== date) fail(`not a real date: ${date}`);
  return ms / 86400000;
}


/** recipe v1.1 ring turn: the chip's per-POSITION counts -> per-SPOT counts. */
export function turnCounts(posCounts, totalTurns) {
  const out = new Array(16).fill(0);
  posCounts.forEach((c, pos) => { out[(pos + totalTurns) % 16] = c; });
  return out;
}

/** wheel.py steps_from_w: active rounds (turns > 0) in order; more than `cap`: `cap` consecutive groups (earlier
 *  groups take the extra round), each the group's mean rounded half up. */
export function stepsFromTurns(w, cap = STEP_CAP) {
  const a = w.filter((t) => t > 0);
  if (a.length <= cap) return a;
  const q = Math.floor(a.length / cap), r = a.length % cap, out = [];
  for (let g = 0, i = 0; g < cap; g++) {
    const n = q + (g < r ? 1 : 0), grp = a.slice(i, i + n);
    i += n;
    out.push(Math.floor(grp.reduce((x, y) => x + y, 0) / n + 0.5));
  }
  return out;
}

/** The contract's reach (QuantumCatch._inReach): the walk starts on spot turns % 16 (his start) and each step moves it
 *  one spot, so after k steps a perfect walk lands only on spots of the right parity ((spot + turns + steps) even) that
 *  are at most k spots from his start around the ring. Out of reach: any landings there are chip noise, and the net
 *  never catches. (Known gap, contracts/README.md: a step after the first with 700+ turns walks back; the rule, which
 *  sees only turns and steps, still calls those spots in reach.) */
export const ringDistance = (a, b) => { const d = Math.abs(a - b) % 16; return Math.min(d, 16 - d); };
export const inReach = (spot, turns, steps) => (spot + turns + steps) % 2 === 0 && ringDistance(spot, turns % 16) <= steps;

/** The owner's rarity rule (5 Nov), as QuantumCatch.tiersOf: catchable = in reach and at least 1 % of the shots
 *  (hits * 100 >= shots); rank the catchable spots by landings, most first, equal landings the lower spot first; with n
 *  of them, rank n is Epic (Legendary when firstShot is on it), n - 1 Rare, n - 3 and n - 2 Uncommon, the rest Common.
 *  Returns the 16 tier codes (0 = got away) and each catchable spot's rank (0 = not catchable) and n. */
export function tiersOf(counts, turns, steps, firstShot) {
  const shots = counts.reduce((a, b) => a + b, 0);
  const order = shots ? [...Array(16).keys()].filter((s) => inReach(s, turns, steps) && counts[s] * 100 >= shots)
    .sort((a, b) => counts[b] - counts[a] || a - b) : [];
  const n = order.length, tiers = new Array(16).fill(0), rank = new Array(16).fill(0);
  order.forEach((s, i) => {
    const r = i + 1;
    rank[s] = r;
    tiers[s] = r === n ? (s === firstShot ? 5 : 4) : r === n - 1 ? 3 : r >= n - 3 ? 2 : 1;
  });
  return { tiers, rank, n };
}

/** Every wheel-<date>-*.json for that night in quantum/ and next to `file` (anything under rejected/ excluded). */
function resultFilesFor(date, extraDirs = []) {
  const dirs = [...new Set([here, ...extraDirs].map((d) => fs.realpathSync(d)))].filter((d) => !d.split(path.sep).includes('rejected'));
  const out = new Set();
  for (const d of dirs) for (const f of fs.readdirSync(d)) if (f.startsWith(`wheel-${date}-`) && f.endsWith('.json')) out.add(path.join(d, f));
  return [...out].sort();
}

function chainNight(chainNights, date) {
  if (!chainNights || !fs.existsSync(chainNights)) fail(`refusing: ${chainNights} (data/chain-nights.json) is missing: it is the only independent record of his night`);
  const cn = JSON.parse(fs.readFileSync(chainNights, 'utf8')).nights?.[date];
  if (!cn) fail(`refusing: night ${date} is not in ${chainNights} (run data/night-from-chain.mjs ${date})`);
  if (cn.complete !== true) fail(`refusing: night ${date} is not complete on the chain yet (complete: ${JSON.stringify(cn.complete)})`);
  if (!Array.isArray(cn.rounds) || !cn.rounds.every((r) => isUint(r?.id, 2 ** 53) && isUint(r?.turns, 2 ** 32 - 1))) fail(`refusing: night ${date} in ${chainNights} has malformed rounds`);
  return cn;
}

export function jobIdBytes32(job) {
  if (!JOB.test(job)) fail(`IBM job id ${JSON.stringify(job)} is not 1-31 chars of [A-Za-z0-9._-]`);
  return ethers.encodeBytes32String(job); // ASCII, right-padded with zero bytes
}

/** Read and check a healthy wheel result file; returns everything postNight needs. Throws on anything off.
 *  `job`: the IBM job to post when the night has more than one result file (CLI --job). */
export function loadWheel(file, { chainNights = path.join(here, '../data/chain-nights.json'), job } = {}) {
  const abs = fs.realpathSync(path.resolve(file));
  if (abs.split(path.sep).includes('rejected')) fail(`refusing ${file}: it is under rejected/ (a chip run that failed the health gate)`);
  const base = path.basename(abs);
  const nm = NAME.exec(base) || fail(`refusing ${base}: not a wheel-<night>-<backend>-<job>.json file`);
  const raw = fs.readFileSync(abs);
  const d = JSON.parse(raw.toString('utf8'));
  if (d.healthy !== true) fail(`refusing ${base}: healthy is ${JSON.stringify(d.healthy)}, not true`);
  if (d.kind !== 'quantum_wheel') fail(`refusing ${base}: kind ${JSON.stringify(d.kind)}`);
  if (d.night !== nm[1] || d.backend !== nm[2] || d.job_id !== nm[3]) fail(`refusing ${base}: file name and contents disagree (night/backend/job)`);
  if (d.recipe !== GAME_RECIPE) fail(`refusing ${base}: recipe ${JSON.stringify(d.recipe)} is not the game's recipe ${JSON.stringify(GAME_RECIPE)}`);
  const all = resultFilesFor(d.night, [path.dirname(abs)]);
  if (job !== undefined && job !== d.job_id) fail(`refusing ${base}: --job ${job} names another IBM job than this file's ${d.job_id}`);
  if (all.length > 1 && job === undefined) {
    fail(`refusing ${base}: there are ${all.length} result files for the night of ${d.night} and a night is posted only once:\n`
      + all.map((f) => `  ${f}`).join('\n') + `\nname the one to post with --job <IBM job id>`);
  }
  const tw = Array.isArray(d.twin) && d.twin.length ? d.twin.reduce((a, p) => a + p.wins, 0) / d.twin.reduce((a, p) => a + p.shots, 0) : 0;
  if (!(tw >= HEALTH_MIN)) fail(`refusing ${base}: twin test ${(100 * tw).toFixed(1)}% is under the ${100 * HEALTH_MIN}% gate although healthy is true`);
  const pos = d.counts;
  if (!Array.isArray(pos) || pos.length !== 16 || !pos.every((c) => isUint(c, 65535))) fail(`refusing ${base}: counts must be 16 integers 0-65535`);
  const shots = pos.reduce((a, b) => a + b, 0);
  if (shots !== d.wheel_shots || shots === 0) fail(`refusing ${base}: counts sum ${shots} != wheel_shots ${d.wheel_shots}`);
  // the chip's shots in order: they must add up to the counts, and the first one is posted (Legendary)
  if (!Array.isArray(d.shots_in_order) || d.shots_in_order.length !== shots) fail(`refusing ${base}: shots_in_order is missing or not ${shots} shots (the first shot is posted)`);
  const re = new Array(16).fill(0);
  for (const s of d.shots_in_order) { if (!isUint(s, 15)) fail(`refusing ${base}: bad shot ${s}`); re[s]++; }
  if (re.some((c, i) => c !== pos[i])) fail(`refusing ${base}: shots_in_order does not add up to counts`);
  if (!Array.isArray(d.rounds) || !d.rounds.every((r) => Array.isArray(r) && r.length === 2 && isUint(r[0], 2 ** 53) && isUint(r[1], 2 ** 32 - 1))) fail(`refusing ${base}: rounds must be [id, turns] pairs`);
  const turns = d.rounds.reduce((a, r) => a + r[1], 0);
  if (!isUint(turns, 2 ** 32 - 1) || turns === 0) fail(`refusing ${base}: total turns ${turns} out of range (a night he slept has no wheel file: use --slept)`);
  const cn = chainNight(chainNights, d.night);
  if (typeof d.core !== 'string' || typeof cn.core !== 'string' || d.core.toLowerCase() !== cn.core.toLowerCase()) fail(`refusing ${base}: core ${d.core} is not the chain record's core ${cn.core}`);
  const same = d.rounds.length === cn.rounds.length && d.rounds.every((r, i) => r[0] === cn.rounds[i].id && r[1] === cn.rounds[i].turns);
  if (!same) {
    const t2 = cn.rounds.reduce((a, r) => a + r.turns, 0);
    fail(`refusing ${base}: its rounds differ from data/chain-nights.json (${d.rounds.length} rounds, ${turns} turns in the file; ${cn.rounds.length} rounds, ${t2} turns on the chain)`);
  }
  const want = stepsFromTurns(cn.rounds.map((r) => r.turns));
  if (!Array.isArray(d.steps) || d.steps.length !== want.length || d.steps.some((t, i) => t !== want[i])) fail(`refusing ${base}: steps ${JSON.stringify(d.steps)} do not follow from the chain rounds by ${GAME_RECIPE} (${JSON.stringify(want)})`);
  const counts = turnCounts(pos, turns);
  const firstPosition = d.shots_in_order[0], firstShot = (firstPosition + turns) % 16;
  if (counts[firstShot] === 0) fail(`refusing ${base}: the first shot's spot ${firstShot} has no landing`); // cannot happen: it is one of them
  return {
    kind: 'ran', file: abs, date: d.night, n: nightNumber(d.night), backend: d.backend, job: d.job_id, recipe: d.recipe,
    others: all.filter((f) => f !== abs), counts, posCounts: pos, shots, turns, ringTurn: turns % 16, steps: want.length,
    firstPosition, firstShot,
    jobId: jobIdBytes32(d.job_id), resultSha256: '0x' + crypto.createHash('sha256').update(raw).digest('hex'),
  };
}

/** A night he did not run: data/chain-nights.json must have it complete with zero turns, and no chip result file. */
export function sleptNight(date, { chainNights = path.join(here, '../data/chain-nights.json') } = {}) {
  nightNumber(date);
  const cn = chainNight(chainNights, date);
  const turns = cn.rounds.reduce((a, r) => a + r.turns, 0);
  if (turns !== 0) fail(`night ${date}: he ran ${turns} turns, so it needs the chip result file, not --slept`);
  const files = resultFilesFor(date);
  if (files.length) fail(`night ${date}: there is a chip result file for it (${files.map((f) => path.basename(f)).join(', ')}), so "he slept" would contradict it`);
  return { kind: 'slept', date, n: nightNumber(date), counts: new Array(16).fill(0), shots: 0, turns: 0, ringTurn: 0, steps: 0, firstShot: 0, jobId: ethers.ZeroHash, resultSha256: ethers.ZeroHash };
}

export const callArgs = (r) => [r.n, r.counts, r.turns, r.steps, r.jobId, r.resultSha256, r.firstShot];
export const calldata = (r) => new ethers.Interface(ABI).encodeFunctionData('postNight', callArgs(r));

export function describe(r) {
  const lines = [];
  if (r.kind === 'ran') {
    lines.push(`night of ${r.date} (n = ${r.n})  ${r.backend}  IBM job ${r.job}  ${r.recipe}`, `file sha256 ${r.resultSha256}`,
      `his total turns ${r.turns} -> ring turn ${r.ringTurn}; ${r.steps} step${r.steps === 1 ? '' : 's'}; ${r.shots} shots`,
      `in reach tonight (the right parity, within ${r.steps} spot${r.steps === 1 ? '' : 's'} of his start, spot ${r.ringTurn}): `
        + [...Array(16).keys()].filter((s) => inReach(s, r.turns, r.steps)).join(', '));
    if (r.others?.length) lines.push(`other result files for this night (NOT posted; a night is posted once): ${r.others.map((f) => path.basename(f)).join(', ')}`);
    const { tiers, rank, n } = tiersOf(r.counts, r.turns, r.steps, r.firstShot);
    lines.push(`the chip's first shot: ${r.firstPosition === undefined ? '' : `position ${r.firstPosition} -> `}spot ${r.firstShot} (${tiers[r.firstShot] === 5 ? 'the Epic spot: Legendary' : 'not the Epic spot: no Legendary tonight'})`,
      `catchable tonight (in reach, >= 1 %): ${n} spot${n === 1 ? '' : 's'}, ranked by landings`);
    r.counts.forEach((c, s) => {
      const reach = inReach(s, r.turns, r.steps), t = TIER_NAMES[tiers[s]]; // out of reach never catches
      lines.push(`  spot ${String(s).padStart(2)}: ${String(c).padStart(5)}  ${(100 * c / r.shots).toFixed(2).padStart(6)} %  ${(t || 'got away').padEnd(10)} ${rank[s] ? `rank ${rank[s]} of ${n}`.padEnd(11) : ''.padEnd(11)} ${reach ? 'in reach' : c ? 'out of reach: chip noise' : 'out of reach: no landings'}`);
    });
  } else lines.push(`night of ${r.date} (n = ${r.n}): he slept, every net reads "he slept"`);
  lines.push('', `postNight(${r.n}, [${r.counts.join(', ')}], ${r.turns}, ${r.steps}, ${r.jobId}, ${r.resultSha256}, ${r.firstShot})`, `calldata ${calldata(r)}`);
  return lines.join('\n');
}

/** Send postNight with a signer the caller provides, after read-only preflight checks. */
export async function send(r, { contract, signer }) {
  const provider = signer.provider || fail('signer has no provider');
  const { chainId } = await provider.getNetwork();
  if (!ALLOWED_CHAINS[chainId]) fail(`chain ${chainId} is not Sepolia or a local anvil: not sending`);
  const qc = new ethers.Contract(contract, ABI, signer);
  const [hatcher, rec, overAt, deadline, block] = await Promise.all([qc.HATCHER(), qc.nightRecord(r.n), qc.nightOverAt(r.n), qc.postDeadline(r.n), provider.getBlock('latest')]);
  const from = await signer.getAddress();
  if (hatcher.toLowerCase() !== from.toLowerCase()) fail(`signer ${from} is not the HATCHER ${hatcher}`);
  if (rec.posted) fail(`night ${r.n} is already posted`);
  if (BigInt(block.timestamp) < overAt) fail(`night ${r.n} is not over until ${new Date(Number(overAt) * 1000).toISOString()}`);
  if (BigInt(block.timestamp) >= deadline) fail(`night ${r.n}: the post window closed at ${new Date(Number(deadline) * 1000).toISOString()} (its nets read "No chip result")`);
  // the contract must rank this night exactly as the poster does (else its rule is not the one shown in the dry run)
  const onChain = (await qc.tiersOf(r.counts, r.turns, r.steps, r.firstShot)).map(Number);
  const mine = tiersOf(r.counts, r.turns, r.steps, r.firstShot).tiers;
  if (onChain.some((t, s) => t !== mine[s])) fail(`the contract's tiersOf ${JSON.stringify(onChain)} differs from the poster's ${JSON.stringify(mine)}: not sending`);
  await qc.postNight.staticCall(...callArgs(r));
  const tx = await qc.postNight(...callArgs(r));
  const receipt = await tx.wait();
  return { hash: tx.hash, status: receipt.status, gasUsed: receipt.gasUsed, chain: ALLOWED_CHAINS[chainId] };
}

async function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const slept = arg('--slept');
  const file = argv.find((a, i) => !a.startsWith('--') && !['--slept', '--contract', '--rpc', '--job'].includes(argv[i - 1]));
  if (!slept && !file) fail('usage: node quantum/post_night.mjs <wheel-...json> [--job <IBM job>] | --slept YYYY-MM-DD  [--contract 0x..] [--rpc URL] [--anvil]');
  if (argv.includes('--job') && !arg('--job')) fail('--job needs the IBM job id');
  const r = slept ? sleptNight(slept) : loadWheel(file, { job: arg('--job') });
  console.log(describe(r));
  if (process.env.GO !== '1') { console.log('\nDRY RUN: nothing sent (GO=1 to send).'); return; }

  const contract = arg('--contract') || fail('GO=1 needs --contract');
  const rpc = arg('--rpc') || fail('GO=1 needs --rpc');
  if (!ethers.isAddress(contract)) fail(`bad --contract ${contract}`);
  if (!argv.includes('--anvil')) {
    // TODO: signer provided by the operator. This script deliberately never loads a key (no key store, no file, no env
    // secret). The operator plugs in their own ethers Signer here (or imports send() with one) for the Sepolia post.
    fail('TODO: signer provided by the operator. Nothing was sent; the dry run above shows the exact call.');
  }
  if (!['127.0.0.1', 'localhost'].includes(new URL(rpc).hostname)) fail('--anvil is for a local anvil only (127.0.0.1)');
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const { chainId } = await provider.getNetwork();
  if (chainId !== 31337n) fail(`--anvil is for a local anvil only (chain 31337, got ${chainId})`);
  const hatcher = await new ethers.Contract(contract, ABI, provider).HATCHER();
  const signer = await provider.getSigner(hatcher); // anvil holds its test accounts unlocked: no key is loaded here
  const out = await send(r, { contract, signer });
  console.log(`\nSENT on ${out.chain}: tx ${out.hash} status ${out.status} gas ${out.gasUsed}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
