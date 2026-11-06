# Quantum Catch

**Squeektoshi's run programs a real quantum computer. Catch the hamster it lands on.**

A browser game on the Sepolia test network (test tokens only, no money value). Squeektoshi is a real hamster on
[Squeekchain](https://squeekchain.com): his wheel turns are measured and settled on Sepolia in 10-minute rounds. Each
night his run becomes a small quantum program, a quantum walk on a ring of 16 spots. After his night, a real IBM quantum
computer runs that program 4,000 times. Cast a net before he runs (0.01 test SQK, burned); nobody picks a spot: one of
the chip's 4,000 shots is your net's, drawn on-chain, and the hamster it landed on is your catch. If that shot is chip
noise (a spot he could not reach), your hamster got away.

A community project. Not made by the Squeekchain team.

## How it works

1. **His night** runs from 12:00 to 12:00 UTC. The turns of every active 10-minute round are read from SqueekCore
   (`roundPage`) on Sepolia: `data/night-from-chain.mjs`, saved in `data/chain-nights.json`.
2. **The program** (`quantum/wheel_spec.md`, `quantum/wheel.py`): one step per active round, grouped into at most 10
   steps. Each step tilts a quantum coin by pi x min(turns, 700) / 700 and moves the hamster one spot left and right at
   once. A lazy round barely moves the coin; a sprint flips it.
3. **The chip looks**: IBM runs the walk 4,000 times and records where every shot landed, in order. The same job runs a
   twin test (a CHSH card game) as a health check: under 79 % the run is thrown out (`quantum/rejected/`) and redone.
4. **His start** is spot (his total turns) mod 16, and every step moves him one spot, so a spot is **in reach** only if
   it has the right parity ((spot + turns + steps) even) and lies at most `steps` spots from his start around the ring.
   Landings out of reach are the chip's noise, and a net there never catches.
5. **What you catch**: the spots in reach that got at least 1 % of the shots are catchable. They are ranked by landings,
   most first (a tie goes to the lower spot number). With n catchable spots, the last one (the fewest landings) is
   **Epic**, the one before it **Rare**, the two before that **Uncommon**, and all the others **Common**. If the chip's
   very first shot of the night landed on the Epic spot, that spot is **Legendary** instead. Any other spot got away.
   With 8 catchable spots that is 4 Common, 2 Uncommon, 1 Rare, 1 Epic. Legendary needs the night's first shot and the
   net's own shot both on the Epic spot, so per net it is about the Epic spot's share squared: about 1 in 250 on the
   10-step nights so far (1 in 190 to 1 in 1,700 on all the real nights).
6. **The hamster**: a spot's 4 bits choose what it wears (bit 0 party hat, bit 1 glasses, bit 2 scarf, bit 3 grin or
   honey face), and the tier chooses its skin. The NFT draws the painted hamster fully on-chain.
7. **Your net**: one net per wallet per night, cast before 21:00 UTC. Each net costs 0.01 Squeekchain test SQK, burned
   when you cast (`contracts/src/SqkFaucet.sol` gives 0.01 per wallet per net night), and is a Sepolia test NFT
   (`contracts/src/QuantumCatch.sol`), cast from a browser wallet with one permit signature and one transaction (test
   tokens and test gas only, no money value); without a wallet the page is for watching. When its night's chip result is
   posted, each net gets one of the night's landings: keccak256(the night, the result's sha256, the IBM job id, the net's
   token id) modulo the number of landings. A night that is not posted within 14 days reads "No chip result" for good.

A normal computer can simulate this small walk. What is real is that every chip result here ran on real IBM hardware,
with real noise, on his real run. The page says for each night whether the chip's landings were closer to the perfect
quantum walk or to a normal (classical) hamster.

## Check a night yourself

Every number is in this repo or on Sepolia. For the night of a day `D`:

1. **His run**: `npm install ethers@6`, then `node data/night-from-chain.mjs D` reads his rounds from SqueekCore
   (read-only, public RPC) into `data/chain-nights.json`. `git diff` shows any difference from the published record.
2. **The chip result**: `quantum/wheel-D-<chip>-<IBM job id>.json` holds his rounds, the steps, the 4,000 landings
   (`counts` per position and `shots_in_order`), the twin test and the IBM job id. Landings are per position: spot =
   (position + his total turns) mod 16. The first shot of the night is `shots_in_order[0]`, turned the same way.
3. **The checks and the exact post**: `node quantum/post_night.mjs quantum/wheel-D-<chip>-<job>.json --job <job>` is a
   dry run. It checks the file against the chain record, rebuilds the steps from his rounds, checks the twin test, turns
   the counts onto the ring, prints every spot's landings and reach, and prints the exact `postNight` call, including the
   sha256 of the result file. Compare it with `nightRecord(n)` on the QuantumCatch contract (n = days since 1 Jan 1970).
4. **The perfect walk**: `quantum/wheel.py` (`ideal_walk`, `normal_walk`) computes what a perfect chip and a normal
   hamster would give for the same steps; each result file stores both as `perfect` and `normal`.
5. **The page**: `python3 wheel/build.py` (numpy) rebuilds `wheel/out/quantum-catch.html` and `wheel/out/results.json`
   from these files. This repo's `index.html` is that page under a standard HTML head, and `results.json` sits next to
   it (the page reads it from there).

IBM jobs can be looked up only by the account that ran them, so the job id is a label you can match, not a link you can
open. The chip itself cannot be checked from here; everything after it can.

## Tests

```
node --test wheel/test/engine.test.mjs wheel/test/catch.test.mjs wheel/test/static.test.mjs
python3 quantum/tests/test_wheel.py
node --test quantum/tests/post_night.test.mjs                  # needs ethers
cd contracts && forge test --offline                           # Foundry; lib/forge-std is vendored
node --test wheel/test/catch.anvil.test.mjs                    # needs anvil and forge build
node wheel/test/page.test.cjs                                  # needs puppeteer, Chrome, anvil and forge build
```

## Contracts (Sepolia)

| | Address |
|---|---|
| QuantumCatch (the nets; 0.01 test SQK each, burned) | [`0x151ec033c914252358bdcdba0548ac6a7b4f7f49`](https://sepolia.etherscan.io/address/0x151ec033c914252358bdcdba0548ac6a7b4f7f49) |
| SQK (Squeekchain's test token, what a net burns) | [`0xd78a3956cf63164d1fa1c622ad3c66623162fa1e`](https://sepolia.etherscan.io/address/0xd78a3956cf63164d1fa1c622ad3c66623162fa1e) |
| SqkFaucet (0.01 test SQK per wallet per night) | `faucetAddress` in `wheel/config.json` |
| QuantumCatch v1 (6 Nov 2026: free nets on a picked spot; stays on chain, its nets keep their results) | [`0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0`](https://sepolia.etherscan.io/address/0xa0b3352b3a436c845e3bf2d251abeda3d474dfe0) |
| PaintedArt (the painted hamsters, on-chain) | [`0x76f4416475e5e3b26f8b4780efeb69b7a34262cb`](https://sepolia.etherscan.io/address/0x76f4416475e5e3b26f8b4780efeb69b7a34262cb) |
| SqueekCore (his rounds, since 4 Nov 2026) | [`0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4`](https://sepolia.etherscan.io/address/0xfd6c166d4b8e2962e65746a13e5a0797cd4de0c4) |
| SqueekCore (his rounds, until 4 Nov 2026) | [`0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44`](https://sepolia.etherscan.io/address/0x980b4424c007caf7a1f3670b48c8eaef7ebc3d44) |

QuantumCatch has no owner, admin, pause, proxy, setters, withdraw or payable functions; the test SQK a net costs is
burned in the same transaction, the game keeps none. One account, the hatcher, posts each night's chip result once. It
can never mint, move or burn a net, and the contract cannot check the numbers it posts: that is what the checks above
are for. The hatcher also sees every net's draw before it posts, so it is trusted for the draws as for every number.
SqkFaucet has no owner and no withdraw either: anyone can refill it with a plain transfer, and it gives each wallet 0.01
test SQK once per night.

## License

MIT (see `LICENSE`). `contracts/lib/forge-std` is forge-std under its own MIT / Apache-2.0 licenses.

Source: https://github.com/Rooaraak/quantum-squeak
