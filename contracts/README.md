# Quantum Catch (contracts)

Free Sepolia test game, no value. `src/QuantumCatch.sol` is a self-written ERC-721 ("Quantum Catch", QCATCH):
a net on one of the 16 spots of the Quantum Wheel (`../quantum/wheel_spec.md`) for one of Squeektoshi's nights.

- `castNet(spot)`: free, one net per wallet per night, token id = `(night << 160) | caster`.
- Nights run 12:00 to 12:00 UTC; nets for night n close at 21:00 UTC (`nightStart(n) + 9 h`). From that
  second on, `castNet` casts for night n + 1 (it never reverts at the lock; it rolls over).
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
  1 Epic (Legendary on about 1 in 250 random nets). Checked against `test/data/tier-vectors.json`
  (`test/data/make_tier_vectors.py`: the 9 real chip files with their real first shot and every other landed spot as
  the first shot, plus 560 synthetic nights and fixed cases, n = 0..8, 294 with a Legendary; the page's tests read the
  same file) through `tiersOf`, through `postNight` + `result` for every spot of the 9 real nights, and against an
  independent sort-based rule in the tests (fuzzed). None of the 9 real nights had its first shot on its Epic spot.
- `result(id)`: status (0 waiting, 1 caught, 2 got away, 3 he slept, 4 no chip result), tier by the rank rule (a net
  out of reach is always got away, tier 0). Status 4 is computed: a night not posted by `postDeadline(n)` can never be
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
  **A net out of reach tonight never catches** (the owner's rule, 5 Nov): landings there are chip noise, so even
  >= 1 % there is status Got away, tier 0 (it is not catchable, so it is not ranked either). The landings stay visible
  (`result().hits`, the Landings trait), `Reach: Out of reach tonight`, the description starts (after "Free Sepolia
  test NFT, no value.") with "Out of reach tonight: he could not land here; the <n> landings here are the chip's
  noise.", and the image shows a small OUT OF REACH mark and "46 of 4000 shots: chip noise" (or "no landings") over
  "he could not land here". A net in reach: caught iff >= 1 %, its tier by the rank rule above.
- No owner, admin, pause, proxy, setters, withdraw, payable functions or token. The hatcher can never cast,
  hold, be approved for, or move a net (`HatcherIsNotAPlayer`).
- `tokenURI`: on-chain JSON + SVG, both base64 data URIs. ERC-4906 `BatchMetadataUpdate` for the whole night on each
  post. Attributes: Night, Spot, Status, Tier, Hat, Glasses, Neckwear, Face, Landings, Shots, IBM job, Steps, Reach,
  Result sha256, First shot ("spot 3", or "none" before a ran night is posted). A caught net's description starts
  (after "Free Sepolia test NFT, no value.") with "Caught: rank 7 of the 8 catchable spots tonight by landings, most
  first." and a Legendary adds "The chip's very first shot of the night landed here." The description states the
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
  `QuantumCatch(hatcher, art)` rejects an art address without code (`ArtHasNoCode`) and creates the renderer
  (`src/CatchArt.sol`, a contract of its own only to keep QuantumCatch under EIP-170: QuantumCatch runtime 9,327
  bytes, initcode 27,938; renderer 18,154; PaintedArt 3,198).
- **Gas and size of tokenURI** (the eth_call a wallet makes; the cap that matters is 30,000,000): the heaviest image
  is looks 15 (hat, glasses, scarf, grin) in the circuit skin (Rare), a 99,541-byte fragment: tokenURI 12.4M gas and
  185,581 bytes (`test/Painted.t.sol`, every looks x tier measured; the least is 2.5M). On the local anvil with the
  real 4 Nov v1.2 night: Common spot 15 10.6M gas / 166,605 bytes, Uncommon spot 3 7.4M / 124,085, Rare spot 11
  7.8M / 130,061, Epic spot 7 11.2M / 174,245, Legendary spot 0 (made-up night) 3.2M / 60,633; every state without a
  painted hamster 0.38M-0.50M / about 6-7 KB. The cost is the two base64 passes (SVG, then JSON):
  `CatchLib.base64` turns 24 input bytes into one 32-character word through a 12-bit table (about half the gas of 3
  bytes at a time; checked against forge's `vm.toBase64` on 100 KB and every length 0..100, and fuzzed).
- **Deploy** (`script/DeployAll.s.sol`, local anvil only for now): 15 ArtChunk data contracts (5,369,688 gas each, the
  last 3,599,067), PaintedArt (1,169,678; its constructor checks every chunk's code hash and order), QuantumCatch with
  its renderer (6,037,641): 17 transactions, 85,982,018 gas in all, each under the 16,777,216 per-transaction cap
  (EIP-7825). It prints every address: `ArtChunk <k> <address>` x 15, `PaintedArt`, `QuantumCatch`, `RENDERER`,
  `HATCHER`, `chain`. Use `--slow` (a 30M block holds only 4 chunk deploys; anvil does not mine the rest of a batch).

## Before deploying to Sepolia (not done; nothing here is broadcast)

- IBM access past the trial end (2026-11-07 ~18:46 UTC) must be settled first. Nets cast for a night the chip
  never runs end as "No chip result" after 14 days; that is the honest end, but the game should not open casting
  while the chip is not available.
- Chip budget: free plan 600 s per rolling 28 days; 245 s were left after the 4 Nov run, about 4 s per night.
- Under the rank rule every night with a catchable spot has exactly one Epic (or Legendary) and, from 2 catchable
  spots on, one Rare. On the two v1.2 nights we have (1 Nov rerun, 4 Nov rerun) all 8 in-reach spots were catchable
  (4 Common, 2 Uncommon, 1 Rare, 1 Epic); neither night's first shot landed on its Epic spot (4 Nov: spot 3, 1 Nov:
  spot 1, out of reach), so neither had a Legendary.
- Deploying the art on Sepolia is 17 transactions and about 86M gas (Sepolia test ETH). `DeployAll` refuses any chain
  but 31337 until the owner decides.
- Before casting opens, look at one caught net where players will see it: testnets.opensea.io (Sepolia) and any other
  target indexer or wallet (its thumbnail and its full view). Painted = fine; the small drawn hamster = that viewer
  cannot decode WebP (the fallback works; worth a README line); a blank card or a broken image = stop and report it
  (nothing here can check OpenSea's own pipeline).
- The public export is `../tools/export-public.sh` (the only one; `quantum/morning.sh` step 7 runs it). Its leak gate
  passes these files: the 15 chunk code hashes in `src/PaintedArt.sol` are hex"" data (decoded and checked), and the
  0x-prefixed sha256 values in `test/data/art-expected.json` sit under hash keys (`assetSha`, `svgSha`,
  `chunkCodehash`). The scripts here that name this machine's tool paths (`script/*.mjs`: Chrome, puppeteer, Foundry)
  are exported with those paths rewritten to the plain command (the export prints every rewrite).

## Run

```
# lib/forge-std is vendored in this repo (unchanged forge-std)
forge test --offline                 # 131 tests
forge test --offline --gas-report   # gas-report.txt
python3 test/data/make_tier_vectors.py                    # regenerate the rank-rule tier vectors (deterministic)
python3 test/data/make_reach_vectors.py                   # regenerate the wheel.py ideal_walk reach vectors
python3 tools/pack_art.py --check                         # the art chunks and generated blocks match wheel/art/art.json
node script/anvil-e2e.mjs <dir>   # local anvil only: DeployAll, cast, post the real 4 Nov
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
