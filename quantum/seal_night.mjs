// Seal a posted night on QuantumCatchV3 (Season 2): seal(n) fixes the night's draw seed from the hash of the block right
// after the post. DRY BY DEFAULT: reads the night's post and seal and prints what a seal would do.
//   node quantum/seal_night.mjs <night number> --contract 0x.. --rpc <url>          read only: the night's seal state
//   GO=1 node quantum/seal_night.mjs <night> --contract 0x.. --rpc http://127.0.0.1:8546 --anvil
//        local anvil only: sends from anvil's first unlocked account (no key anywhere)
// Anyone can seal (the game checks nothing about the sender), from block postBlock + 2 on (the hash of block
// postBlock + 1 exists from then). Seal at once: the game takes that hash from BLOCKHASH to postBlock + 257 and from the
// EIP-2935 history to postBlock + 8192 (about 27 h); after that a later block's hash decides, one new choice per 256
// blocks. After the seal this checks it: seed = keccak256(abi.encode(the hash of seedBlock, resultSha256, jobId)), read
// back from the chain. Exports sealNight(), checkSeal() and unsealedNights() (the ops sweep: posted but not sealed).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';

export const ABI = [
  'function seal(uint32 n) returns (bytes32)',
  'function sealBlockFor(uint256 postBlock) view returns (uint256)',
  'function sealOf(uint32 n) view returns (uint64 postBlock, uint64 seedBlock, bytes32 seed)',
  'function nightRecord(uint32 n) view returns (bool posted, uint16[16] counts, uint32 shots, uint32 turns, uint8 ringTurn, uint8 steps, bytes32 jobId, bytes32 resultSha256, uint8 firstShot)',
  'event NightSealed(uint32 indexed night, uint256 seedBlock, bytes32 blockHash, bytes32 seed)',
];
export const ALLOWED_CHAINS = { 31337n: 'local anvil', 11155111n: 'Sepolia' };
const fail = (m) => { throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** the night's seal as the chain has it, checked: { postBlock, seedBlock, seed, late } (seedBlock 0 = not sealed) */
export async function checkSeal(provider, contract, n) {
  const qc = new ethers.Contract(contract, ABI, provider);
  const [rec, s] = await Promise.all([qc.nightRecord(n), qc.sealOf(n)]);
  const postBlock = Number(s.postBlock), seedBlock = Number(s.seedBlock);
  if (!rec.posted) return { posted: false, postBlock, seedBlock: 0, seed: ethers.ZeroHash };
  if (seedBlock === 0) return { posted: true, postBlock, seedBlock: 0, seed: ethers.ZeroHash };
  const blk = await provider.getBlock(seedBlock);
  if (!blk) fail(`block ${seedBlock} not found`);
  const want = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'bytes32', 'bytes32'], [blk.hash, rec.resultSha256, rec.jobId]));
  if (want !== s.seed) fail(`night ${n}: seed ${s.seed} is not keccak256(hash of block ${seedBlock}, sha256, job) = ${want}`);
  return { posted: true, postBlock, seedBlock, seed: s.seed, blockHash: blk.hash, late: seedBlock !== postBlock + 1 };
}

/** the nights from..to (inclusive) that are posted but NOT sealed, with how many blocks are left before the seal stops
 *  being the in-time one (postBlock + 8192): [{ night, postBlock, blocksLeft }] */
export async function unsealedNights(provider, contract, from, to) {
  const qc = new ethers.Contract(contract, ABI, provider);
  const head = await provider.getBlockNumber();
  const out = [];
  for (let n = from; n <= to; n++) {
    const [rec, s] = await Promise.all([qc.nightRecord(n), qc.sealOf(n)]);
    if (!rec.posted || Number(s.seedBlock) !== 0) continue;
    out.push({ night: n, postBlock: Number(s.postBlock), blocksLeft: Number(s.postBlock) + 8192 - head });
  }
  return out;
}

/** seal night n with `signer` as soon as the chain allows (block >= postBlock + 2), then check it */
export async function sealNight(n, { contract, signer, maxWaitMs = 120000, pollMs = 2000 }) {
  const provider = signer.provider || fail('signer has no provider');
  const { chainId } = await provider.getNetwork();
  if (!ALLOWED_CHAINS[chainId]) fail(`chain ${chainId} is not Sepolia or a local anvil: not sending`);
  const qc = new ethers.Contract(contract, ABI, signer);
  const st = await checkSeal(provider, contract, n);
  if (!st.posted) fail(`night ${n} is not posted`);
  if (st.seedBlock) return { already: true, ...st };
  const t0 = Date.now();
  // the seal needs block.number >= postBlock + 2; its dry run (eth_call) runs at the LATEST block's number, so wait until
  // the latest block is postBlock + 2 (the transaction then lands in postBlock + 3 or later: still the post + 1 hash)
  while (BigInt(await provider.getBlockNumber()) < BigInt(st.postBlock) + 2n) {
    if (Date.now() - t0 > maxWaitMs) fail(`night ${n}: block ${st.postBlock + 2} did not come within ${maxWaitMs} ms`);
    await sleep(pollMs);
  }
  await qc.seal.staticCall(n);
  const tx = await qc.seal(n);
  const receipt = await tx.wait();
  if (receipt.status !== 1) fail(`seal ${tx.hash} FAILED`);
  const out = await checkSeal(provider, contract, n);
  if (!out.seedBlock) fail('sealed but sealOf says not sealed');
  return { hash: tx.hash, gasUsed: receipt.gasUsed, chain: ALLOWED_CHAINS[chainId], ...out };
}

async function main(argv) {
  const arg = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const n = Number(argv.find((a, i) => /^\d+$/.test(a) && !['--contract', '--rpc'].includes(argv[i - 1])));
  const contract = arg('--contract'), rpc = arg('--rpc');
  if (!Number.isInteger(n) || !contract || !rpc) fail('usage: node quantum/seal_night.mjs <night> --contract 0x.. --rpc URL [--anvil]');
  const provider = new ethers.JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const st = await checkSeal(provider, contract, n);
  console.log(`night ${n}: posted ${st.posted}, post block ${st.postBlock}, ` + (st.seedBlock ? `SEALED with block ${st.seedBlock}${st.late ? ' (LATE)' : ''}: seed ${st.seed}` : 'not sealed'));
  if (process.env.GO !== '1' || st.seedBlock || !st.posted) { if (!st.seedBlock) console.log('DRY RUN: nothing sent (GO=1 to seal).'); return; }
  if (!argv.includes('--anvil')) fail('TODO: signer provided by the operator (anyone can seal; ops/post-night-v3.mjs seals right after its post).');
  if (!['127.0.0.1', 'localhost'].includes(new URL(rpc).hostname)) fail('--anvil is for a local anvil only (127.0.0.1)');
  if ((await provider.getNetwork()).chainId !== 31337n) fail('--anvil is for a local anvil only (chain 31337)');
  const [first] = await provider.send('eth_accounts', []);
  const out = await sealNight(n, { contract, signer: await provider.getSigner(first), pollMs: 200 });
  console.log(`SEALED on ${out.chain}: tx ${out.hash} gas ${out.gasUsed}, block ${out.seedBlock}, seed ${out.seed}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e.message || e)); process.exit(1); });
}
