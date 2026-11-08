# Quantum Catch (contracts)

Sepolia test game, no value. `src/QuantumCatch.sol` is a self-written ERC-721 ("Quantum Catch", QCATCH): a net for
one of Squeektoshi's nights on the Quantum Wheel (`../quantum/wheel_spec.md`), a ticket for one of the chip's shots.
Version 2 (the owner's rules of 6 Nov): nobody picks a spot, a net costs 0.01 Squeekchain TEST SQK that is burned,
the holder can burn a net, and `src/SqkFaucet.sol` hands out the test SQK.

- `castNet()`: no spot, one net per wallet per night, token id = `(night << 160) | caster`. With `SQK` set it takes
  exactly `NET_COST` of the caller's own allowance (`transferFrom` caller -> game) and burns it in the same call
  (`SQK.burn`), so the game never holds SQK; events: the token's Transfer (caster -> game) and Transfer (game -> 0),
  then the net's Transfer, `NetCast(night, catcher, tokenId)` and `NetPaid(night, catcher, burned)`. With `SQK` unset
  (address 0, `NET_COST` 0) nets are free, as in version 1. `castNetWithPermit(deadline, v, r, s)` first sets that
  allowance from an EIP-2612 permit (a permit someone already submitted is ignored and its allowance used), then casts:
  one transaction without an approve.
- Nights run 12:00 to 12:00 UTC; nets for night n close at 21:00 UTC (`nightStart(n) + 9 h`). From that
  second on, `castNet` casts for night n + 1 (it never reverts at the lock; it rolls over).
- **The draw** (`drawOf(n, resultSha256, jobId, tokenId, counts)`, pure): once night n is posted, each net gets
  exactly one of the night's shots, drawn over ALL its landings: `x = uint256(keccak256(abi.encode(n, resultSha256,
  jobId, tokenId))) % shots`, then spots 0..15 in order, each taking its count of the values. The sha256 of the result
  file and the IBM job id exist only after the chip ran (after the nets closed), so no caster can know or choose its
  draw. The hatcher posts the real file's numbers and holds no net, but it sees every draw before it posts (it could
  choose among chip runs or re-serialized files), so it is trusted for the draws as for every number (the metadata
  says so). The net catches the drawn spot's hamster if that
  spot is catchable (below), else the hamster got away; so the chance of nothing is the chip's own noise share (about
  4 % to 14 % on the real nights: 3.9 % to 13.9 %). A slept night draws nothing. `spotOf(id)` / `result().spot` is the drawn spot, 255
  (`NO_SPOT`) until the night is posted (and when he slept or no result came). Checked in `test/Draw.t.sol` against an
  independent running-sum reference, with frequency tests over many token ids.
- `burn(id)`: by the holder, or an address it approved for that net or for all its nets (a later game contract);
  nobody else, no admin burn, never the hatcher. A burned net is gone (`ownerOf`, `tokenURI`, `result`, `traitsOf`
  revert; `balanceOf` drops) and its id can never be cast again (`AlreadyCast`).
- `traitsOf(id)`: `(night, posted, caught, spot, hat, glasses, scarf, grin, tier)` in one read for later games; before
  the post everything but the night is 0; he slept: posted, spot 255; got away: the drawn spot, no look bits, tier 0.
- `SqkFaucet(token, drip, catch_)`: `claim()` sends `DRIP` (0.01 test SQK, one net) once per address per net night
  (`catch_.openNightAt(now)`: it turns at 21:00 UTC with the nets); `canClaim(address)`, `lastClaimNight(address)`,
  `remaining()`; errors `AlreadyClaimedTonight(night)`, `FaucetEmpty()`. No owner, no withdraw; anyone refills it with
  a plain token transfer. Test tokens: no sybil defence beyond one claim per address per night.
- `postNight(n, counts[16], turns, steps, jobId, sha256, firstShot)`: HATCHER only, once per night, from 12:00 UTC the
  next day until `postDeadline(n)` = 14 days later (`POST_WINDOW`). Counts are per SPOT (already turned by the v1.1
  ring turn). `firstShot` is the SPOT of the chip's very first shot of the night (the result file's
  `shots_in_order[0]`, a position, turned the same way: `(position + turns) % 16`). `turns == 0` = he slept (all
  counts 0, steps 0, firstShot 0); else at least one landing, 1 <= steps <= min(16, turns), and firstShot a spot with
  a landing (`BadFirstShot`). Nothing else is checkable on-chain: the hatcher is trusted for every number (the
  metadata says so). `nightRecord(n)` returns firstShot last; `NightPosted` carries it.
- **Rarity (the owner's rule, 5 Nov; `tiersOf(counts, turns, steps, firstShot)`, replaces the share tiers)**: the
  CATCHABLE spots of a night are the spots in reach (below) with at least 1 % of the shots (`hits * 100 >= shots`).
  Rank them by landings, most first; equal landings: the lower spot first. With n of them, rank r: Epic r = n, Rare
  r = n - 1, Uncommon r = n - 3 or n - 2, Common r <= n - 4; LEGENDARY = the Epic spot when firstShot landed on it.
  Every other spot got away (tier 0). Tier codes 1 Common .. 5 Legendary. For n = 8: 4 Common, 2 Uncommon, 1 Rare,
  1 Epic. Per net, Legendary is about the Epic spot's share squared (the night's first shot and the net's own drawn
  shot both on the Epic spot): about 1 in 250 on the two 10-step v1.2 nights, 1 in 190 to 1 in 1,700 on the 9 real
  chip files. Checked against `test/data/tier-vectors.json`
  (`test/data/make_tier_vectors.py`: the 9 real chip files with their real first shot and every other landed spot as
  the first shot, plus 560 synthetic nights and fixed cases, n = 0..8, 294 with a Legendary; the page's tests read the
  same file) through `tiersOf`, through `postNight` + `result` for every spot of the 9 real nights, and against an
  independent sort-based rule in the tests (fuzzed). None of the 9 real nights had its first shot on its Epic spot.
- `result(id)`: status (0 waiting, 1 caught, 2 got away, 3 he slept, 4 no chip result), the drawn spot (255 before
  the draw), its landings, the night's shots, tier by the rank rule on the drawn spot (a shot out of reach is always
  got away, tier 0), looks (the drawn spot when caught, else 0). Status 4 is computed: a night not posted by `postDeadline(n)` can never be
  posted, so its nets read "No chip result" for good (no event is emitted at that moment; marketplaces may need a
  metadata refresh).
- `reachOf(id)`: 1 in reach, 2 out of reach tonight, 0 not known. The walk starts on his start, spot `turns % 16`
  (the v1.1 ring turn), and each step moves it one spot, so after k steps a perfect walk can only land on spots of the
  right parity within k spots of his start: in reach iff `(spot + turns + steps)` is even AND
  `circularDistance(spot, turns % 16) <= steps`, where `circularDistance(a, b) = min(|a - b|, 16 - |a - b|)`. From 7
  steps on the distance excludes nothing (the parity rule alone, as before); on a short night (he sometimes runs under
  1 h = 6 rounds) it does: after 1 step only the 2 neighbours of his start (positions 3..13 have P = 0).
  Checked against `wheel.py ideal_walk` (turned by the ring turn, P > 1e-12) on every spot of 598 random nights with
  k = 1..16 and every spot of 12 with k = 0 (the rule alone: 0 steps = he slept, nothing to post), weighted to
  k = 1..7: `test/data/reach-vectors.json` from `test/data/make_reach_vectors.py`, through `postNight`, `reachOf` and
  `result` in `test/Reach.t.sol`, and in `post_night.test.mjs`. Step turns are drawn from his real rounds
  (`data/chain-nights.json`), from 1..699, and with some 700+.
  **The one known exception** (the contract sees only turns and steps, not each step's turns): a step AFTER THE
  FIRST with 700 or more turns. Its coin flips fully (`wheel.py angle()` = pi) and sends the walk straight back over
  the step before it (that pair moves nowhere), so the walk can reach fewer spots than the rule says, and the rule
  still calls them in reach (noise there could catch). 100 then 700 turns lands only on his start, not on the spots
  2 away; every step 700+ (k >= 2) only swings between his start and its two neighbours. A first step of 700+ is not
  part of it (checked, kept). The generator skips exactly this case (72 of 682 drawn nights) and fails on any other
  difference between the rule and the walk. His biggest round in the 7 nights so far is 667 turns, and a v1.2 step
  is a round or the mean of a group of rounds, so it has not happened yet.
  Close to it: steps just under 700 turns (the coin almost flips) leave the far spots a chance above 0 but tiny. 7
  steps of 667 turns give the 2 farthest spots P = 1.3e-14, under the 1e-12 cut; the rule calls them in reach. None
  of the drawn nights hit this; it is pinned with the exception's examples under `known` in the vector file
  (`test_known_cases_follow_the_rule`). The walk never lands outside the rule: out of reach is always exact.
  **A shot out of reach tonight never catches** (the owner's rule, 5 Nov): landings there are chip noise, so even
  >= 1 % there is status Got away, tier 0 (it is not catchable, so it is not ranked either). The landings stay visible
  (`result().hits`, the Landings trait), `Reach: Out of reach tonight`, the description starts (after "Sepolia test
  NFT, no value. Its shot landed on spot <s>.") with "Out of reach tonight: he could not land here; the <n> landings
  here are the chip's noise.", and the image shows a small OUT OF REACH mark and "46 of 4000 shots: chip noise" (or "no landings") over
  "he could not land here". A net in reach: caught iff >= 1 %, its tier by the rank rule above.
- No owner, admin, pause, proxy, setters, withdraw or payable functions, and no token of its own (`SQK` and
  `NET_COST` are immutable; SQK sent to the game by a plain transfer stays there for good). The hatcher can never
  cast, hold, be approved for, move or burn a net (`HatcherIsNotAPlayer`). `test/Honesty.t.sol` calls 24 admin-style
  functions on the game and the faucet: all revert, and neither takes ETH.
- `tokenURI`: on-chain JSON + SVG, both base64 data URIs. ERC-4906 `BatchMetadataUpdate` for the whole night on each
  post. Attributes: Night, Spot (once drawn), Status, Tier, Hat, Glasses, Neckwear, Face (when caught), Landings,
  Shots, IBM job, Steps, Reach, Result sha256, First shot ("spot 3", or "none" before a ran night is posted). Before
  the draw the name has no spot and the card reads "night of <date>" over "its spot is drawn after the run". A caught
  net's description starts (after "Sepolia test NFT, no value. Its shot landed on spot <s>.") with "Caught: rank 7 of
  the 8 catchable spots tonight by landings, most first." and a Legendary adds "The chip's very first shot of the
  night landed here." The description states the
  rank rule, the hatcher's powers (post once, inside the window; never mint, move or burn), that the contract cannot
  check the numbers (and how to check the first shot: the first entry of the file's shots_in_order plus his total
  turns, mod 16), the reach rule ("After its 3 steps a perfect walk can only land on spots of the right parity within
  3 spots of his start (spot 9): those are the spots in reach tonight."; before the post, or when he slept, the same
  with k), that out of reach never catches, and the No chip result end.
- **The image of a caught net is the PAINTED hamster** (the owner's art decision): `ART.hamster(spot, tier)` from
  `src/PaintedArt.sol`, placed as `<g id="painted" transform="translate(70.4 14.4) scale(.4)">` where the drawn
  hamster stood, inside the ring of dots and above the caption. PaintedArt composes it like the page's `composite()`:
  body-<face> (Common) or skin-<tiger|circuit|crystal|gold>-<face> (Uncommon, Rare, Epic, Legendary), every worn
  item's -erase layer cut out of it by a luminance mask (= destination-out), then the item's -shadow and the item
  (bit 0 party hat, bit 1 glasses, bit 2 scarf, bit 3 grin). The 19 webp sprites (already base64) live in 15 data
  contracts `src/ArtChunkNN.sol` (STOP + 24,575 bytes each; `tools/pack_art.py` packs them from `wheel/art/art.json`,
  writes the generated blocks and `art/index.json`, and is the reference renderer: `test/PaintedArt.t.sol` checks
  hamster() byte for byte for 16 looks x tiers 0..5, `--check` fails on a stale generated file). Waiting, got away,
  he slept and no chip result draw no painted hamster (he slept: the small drawn one, asleep). If ART is 0 or
  reverts, a caught net falls back to the small drawn hamster.
  **The WebP fallback** (review, 5 Nov): the sprites are WebP, and some rasterizers cannot decode WebP inside an SVG
  (sharp 0.35.4 / libvips 8.18.6 with its bundled librsvg 2.62.91, which many NFT indexers and CDNs use for thumbnails,
  drew no hamster at all: only the tier colour, the ring and the caption; WebP also needs Safari / iOS 14+). So under
  the painted group every caught card carries the drawn hamster with the net's own items (hat, glasses, scarf, grin),
  `<g id="fallback" transform="translate(84.7 89) scale(.48)">`, about 1.2 KB of vector. It lies wholly inside the
  opaque part of every painted look x tier with 4.4 card units to spare (`tools/fallback_fit.py`, from art.json), so
  where WebP decodes the painted hamster covers it completely: `script/fallback-check.mjs` renders all 80 caught cards
  (16 looks x tiers 1..5, from the deployed renderer) in Chrome with and without the fallback and finds the same
  pixels on every one (a control with the drawn hamster at full size differs on 18,601). Where WebP does not decode,
  the drawn hamster shows (Chrome without the WebP layers: 9,608 to 15,345 of the 44,800 pixels of the hamster box;
  sharp: 6,186 to 9,853 of 28,672, against 0 without the fallback). `ART` and `RENDERER` are immutable: the constructor
  `QuantumCatch(hatcher, art, sqk, netCost)` rejects an art address without code (`ArtHasNoCode`), an `sqk` without
  code (`SqkHasNoCode`), a cost of 0 with `sqk` set or above 0 without it (`BadNetCost`), and creates the renderer
  (`src/CatchArt.sol`, a contract of its own only to keep QuantumCatch under EIP-170: QuantumCatch runtime 11,344
  bytes, initcode 31,133; renderer 19,090; PaintedArt 3,198; SqkFaucet 1,713).
- **Gas and size of tokenURI** (the eth_call a wallet makes; measured caps: 16,762,214 gas on publicnode, tenderly and
  Alchemy, not the 30,000,000 this line used to say): the heaviest image
  is looks 15 (hat, glasses, scarf, grin) in the circuit skin (Rare), a 99,541-byte fragment: tokenURI 12.4M gas and
  185,581 bytes (`test/Painted.t.sol`, every looks x tier measured; the least is 2.5M). On the local anvil with the
  real 4 Nov v1.2 night: Common spot 15 10.6M gas / 166,605 bytes, Uncommon spot 3 7.4M / 124,085, Rare spot 11
  7.8M / 130,061, Epic spot 7 11.2M / 174,245, Legendary spot 0 (made-up night) 3.2M / 60,633; every state without a
  painted hamster 0.38M-0.50M / about 6-7 KB. The cost is the two base64 passes (SVG, then JSON):
  `CatchLib.base64` turns 24 input bytes into one 32-character word through a 12-bit table (about half the gas of 3
  bytes at a time; checked against forge's `vm.toBase64` on 100 KB and every length 0..100, and fuzzed).
- **Deploy** (`script/DeployAll.s.sol`, local anvil only; env `HATCHER`, optional `SQK` + `NET_COST` for paid nets):
  15 ArtChunk data contracts (5,369,688 gas each, the last 3,599,067), PaintedArt (1,169,678; its constructor checks
  every chunk's code hash and order), QuantumCatch with its renderer (6,674,851 on anvil): 17 transactions, 86,619,228
  gas in all, each under the 16,777,216 per-transaction cap (EIP-7825). It prints every address: `ArtChunk <k>
  <address>` x 15, `PaintedArt`, `QuantumCatch`, `RENDERER`, `HATCHER`, `SQK`, `NET_COST`, `chain`. Use `--slow` (a
  30M block holds only 4 chunk deploys; anvil does not mine the rest of a batch). Version 2 on Sepolia reuses version
  1's PaintedArt and HATCHER: QuantumCatch(hatcher, art, test SQK, 0.01 SQK), then SqkFaucet(test SQK, 0.01, that
  QuantumCatch); Sepolia prices new code far higher than anvil (QuantumCatch about 48M gas there).

## Sepolia deploys (version 1 on 6 Nov 2026, block 12072952; version 2 needs the owner's OK) and open items

- IBM access past the trial end (2026-11-07 ~18:46 UTC) must be settled first. Nets cast for a night the chip
  never runs end as "No chip result" after 14 days; that is the honest end, but the game should not open casting
  while the chip is not available.
- Chip budget: free plan 600 s per rolling 28 days; 245 s were left after the 4 Nov run, about 4 s per night.
- Under the rank rule every night with a catchable spot has exactly one Epic (or Legendary) and, from 2 catchable
  spots on, one Rare. On the two v1.2 nights we have (1 Nov rerun, 4 Nov rerun) all 8 in-reach spots were catchable
  (4 Common, 2 Uncommon, 1 Rare, 1 Epic); neither night's first shot landed on its Epic spot (4 Nov: spot 3, 1 Nov:
  spot 1, out of reach), so neither had a Legendary.
- Version 1 (the art, 17 transactions) is on Sepolia since 6 Nov 2026; version 2 reuses its PaintedArt and HATCHER.
  `DeployAll` deploys on a local anvil only (it refuses any chain but 31337); Sepolia deploys run from private ops
  scripts with the owner's OK.
- Before casting opens, look at one caught net where players will see it: testnets.opensea.io (Sepolia) and any other
  target indexer or wallet (its thumbnail and its full view). Painted = fine; the small drawn hamster = that viewer
  cannot decode WebP (the fallback works; worth a README line); a blank card or a broken image = stop and report it
  (nothing here can check OpenSea's own pipeline).
- The public export is `../tools/export-public.sh` (the only one; `quantum/morning.sh` step 7 runs it). Its leak gate
  passes these files: the 15 chunk code hashes in `src/PaintedArt.sol` are hex"" data (decoded and checked), and the
  0x-prefixed sha256 values in `test/data/art-expected.json` sit under hash keys (`assetSha`, `svgSha`,
  `chunkCodehash`). The scripts here that name this machine's tool paths (`script/*.mjs`: Chrome, puppeteer, Foundry)
  are exported with those paths rewritten to the plain command (the export prints every rewrite).

## Season 2 (QuantumCatchV3, S2Renderer: built 7 Nov 2026, not deployed)

- **The game** (`src/QuantumCatchV3.sol`): Season 1's game (v2) with a hamster generator. Clock, nets, SQK payment and
  permit, burn, `postNight` and `tiersOf` are v2's; `openNightAt` / `nightOf` / `DAY` / `DAY_OFFSET` / `LOCK` are byte
  for byte v2's (fuzzed against v2), so v2's `SqkFaucet` serves it. Name "Quantum Catch Season 2", symbol `QCATCH2`.
- **The seal**: `postNight` records its block P; from block P + 2 on anyone can call `seal(n)` once: seed =
  `keccak256(abi.encode(h, resultSha256, jobId))`, h = the hash of block P + 1: from BLOCKHASH to block P + 257,
  then from the EIP-2935 block-history contract to P + 8192 (about 27 hours), so a late seal gives the same seed;
  only after that the hash of the newest block P + 1 + 256 k before the seal (one new choice per 256 blocks:
  `sealBlockFor(postBlock)` tells which). Until then the night's nets read status 5, Drawing. Every draw uses the seed:
  the main one `keccak256(abi.encode(uint32 night, bytes32 seed, uint256 tokenId))` and slot k = 1..10 (Face, Head,
  Eyes, Mouth, Neck, Hands, Back, Special, Aura, Background) the same with `uint256 k` appended, each walked over the
  night's landings (x = word % shots). So nobody, the hatcher included, knows a draw when the numbers are posted.
  A wallet's net on v2 and on v3 for the same night draws differently.
- **The raw DNA** (`dnaOf`, `dnaFor`): status, tier, spot, shots, the main word, and per slot the drawn tier, spot,
  landing and word. Only numbers the chip and the seal decided.
- **The owner** (the deployer) can do two things: `setRenderer(r)` (how every net looks: art, trait lists, names,
  metadata text) and `lock()` (owner = 0 for good; then nothing can change). The draw never reads the renderer
  (`dnaOf`, `result`, `drawOf`, `tiersOf`, `spotOf`, `reachOf`, `sealOf`; tested before and after a swap). `traitsOf`
  gives the current renderer's skin and item ids (they change until lock).
- **The renderer** (`src/S2Renderer.sol` + `src/S2Text.sol` + the data contracts `src/S2Directory.sol` and
  `src/S2Art000.sol` .. `S2Art116.sol`, which start with 0xfe so no call or ETH can stick): the looks rule (skin from the
  main tier and word; per slot: Common or noise = nothing, else the tier's list, an Epic shot shows a Rare item when the
  word's top bit is 0, a Legendary shot without its own list uses the Epic list; a face not painted for the skin shows
  honey, no astronaut helmet on stuffed cheeks, the Schroedinger box hides neck and hands when it outranks them, else
  it goes) and the card: the background picture over the whole card, the ring, the painted 224 x 300 hamster (aura,
  the skin x face cut by the worn items' erase layers, the items back to front), the caption on a dark band and the
  tier colour as the border (since 8 Nov, by setRenderer: `ops/set-renderer-v3.mjs`). tokenURI is v1's format (base64 JSON with a base64 SVG) built
  from elements stored base64 twice (each padded to 9 bytes), so nothing is encoded per call: the heaviest card
  (every slot's heaviest element) is 324,761 bytes and 1.48M gas cold; a typical card 1.04M gas through the game.
- **The launch art**: the builder spec's lists (sec. 2.1, sprout on the Head's Rare list so that every Uncommon item
  stays more common than every Rare one with half-crazy: `tools/s2_odds.py`), 11 skins with 80 skin x face pictures
  (a missing pair shows the honey face), 61 items, 6 auras, 9 backgrounds.
- **Sizes** (runtime): QuantumCatchV3 14,409, S2Renderer 11,301, S2Text 20,297, S2Directory 6,915, 117 art chunks
  (2,861,296 bytes of art).
- **Tests**: `test/V3Core.t.sol`, `test/V3More.t.sol`, `test/S2Render.t.sol` (tokenURI byte for byte against the
  reference renderer for every stored element and every state, 2,700 simulated draws, the worst card's gas, sizes,
  honesty, invariants, the faucet, slot frequencies over 20,000 nets) and `script/anvil-e2e-s2.mjs` (local anvil:
  deploy, faucet and permit casts, a real post, the seal, a golden night, every card, the page reader, a renderer swap,
  lock, burn).

## Run

```
# lib/forge-std is vendored in this repo (unchanged forge-std)
forge test --offline                 # 196 tests (4 skip: the fork tests)
SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com SEPOLIA_FORK_BLOCK=<head - 8> \
  forge test --match-path test/SqkFork.t.sol   # the REAL test SQK, forked
forge test --offline --gas-report   # gas-report.txt
python3 test/data/make_tier_vectors.py                    # regenerate the rank-rule tier vectors (deterministic)
python3 test/data/make_reach_vectors.py                   # regenerate the wheel.py ideal_walk reach vectors
python3 tools/pack_art.py --check                         # the art chunks and generated blocks match wheel/art/art.json
node script/anvil-e2e.mjs <dir>   # local anvil only: a mock SQK, DeployAll (paid nets),
                                                          # casters found by drawOf for each state, post the real 4 Nov
                                                          # result (poster), a made-up Legendary night, he slept, no
                                                          # chip result; checks every state, tokenURI gas and size
node script/render-states.mjs <dir>   # Chrome: every state's image as <img src=data:...>
node script/fallback-check.mjs <dir>  # Chrome: the 80 caught cards (anvil-e2e's looks/) with
                                                          # and without the WebP fallback: same pixels; without WebP the
                                                          # drawn hamster shows (SHARP_MODULE=<sharp dir>: sharp too)
python3 tools/fallback_fit.py  # the fallback's clearance inside every painted look (>= 3)
node script/art-render-check.mjs      # Chrome: PaintedArt vs the page's composite()
forge script script/Preview.s.sol --offline   # tokenURIs, every state,
                                                          # without the painted art (short output)
node --test ../quantum/tests/post_night.test.mjs          # the poster's checks
node script/anvil-e2e-s2.mjs <dir>   # Season 2 end to end on a local anvil
```

The poster `../quantum/post_night.mjs` is dry by default. It posts the first shot with the counts (a file without
`shots_in_order` is refused), prints every spot's tier and rank by the rank rule, and before sending checks that the
contract's `tiersOf` ranks the night exactly as it does. With `GO=1` it sends only with `--anvil` on a local
anvil (the HATCHER account anvil holds unlocked); the Sepolia signer is a TODO for the operator. No key loading.
A night's first post is permanent, so the poster fails closed: `data/chain-nights.json` must list the night as
complete with the file's core and exactly the file's rounds; the file's recipe must be the game's (`wheel_spec.md
v1.2`) and its steps must follow from the chain rounds; and a night with more than one `wheel-<night>-*.json`
(outside `rejected/`) needs `--job <IBM job id>` to name the one to post (1 Nov and 4 Nov have a v1 and a v1.2 file).
It also refuses a send after `postDeadline(n)`.
