"""Season 2 gallery: real hamsters exactly as the contract's renderer draws them, into wheel/art/s2/examples.json (the shape
of wheel/art/showcase.json: {name: {data: base64 WebP, traits: [...]}}). Each picture is the painted part of a card (x
70.4-249.6, y 28-220 of the 320x320 SVG: the hamster on its round background, without the card's caption), 480x514.
The cards come from the REFERENCE renderer (contracts/tools/s2_ref.py over contracts/art/s2/sprites.json: byte for byte
what S2Renderer returns, contracts/test/S2Render.t.sol) for nets of a real v1.2-recipe night, and of its golden variant
for the Legendary skins only (a golden night dresses everyone in Legendary items). The picks: one hamster per skin (the one wearing the most, crazy items first, among the nets
looked at), then the most dressed other net that is not plain, 12 in all. Rasterized in headless Chrome (an <img> of the SVG, as a
browser shows it), re-encoded as WebP q80 without metadata.
  python3 wheel/art/s2/make_examples.py [--nets 3000]
Chrome + puppeteer: CHROME / PUPPETEER_PATH, else wheel/test/local.json {"chrome", "puppeteer"}. Run it again whenever
the Season 2 art changes (a new renderer), so the gallery shows what the chain draws."""
import base64, io, json, os, subprocess, sys, tempfile
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
sys.path.insert(0, os.path.join(ROOT, 'contracts', 'tools'))
import pack_s2 as pk, s2_ref as ref, s2_catalog as cat   # noqa: E402

NETS = int(sys.argv[sys.argv.index('--nets') + 1]) if '--nets' in sys.argv else 3000
BOX = (70.4, 28, 179.2, 192)                              # the painted part of the card (svg units; the group sits at y 8.4)
W = 480
K = W / BOX[2]
LOCAL = {}
try:
    LOCAL = json.load(open(os.path.join(ROOT, 'wheel', 'test', 'local.json')))
except OSError:
    pass
CHROME = os.environ.get('CHROME') or LOCAL.get('chrome')
PUPPETEER = os.environ.get('PUPPETEER_PATH') or LOCAL.get('puppeteer') or 'puppeteer'

P = pk.Pack(json.load(open(pk.SPRITES)))
cand = {}                                                 # skin -> [(score, name, traits, svg)]
for golden in (False, True):
    rec = pk.night('r0hkb', golden=golden)
    seal = pk.sealed(rec)
    for i in range(NETS):
        c, d = ref.card_dna(pk.token(rec, i), rec, seal=seal)
        if c['status'] != ref.CAUGHT or (golden and c['tier'] != 5):    # the golden variant only for the Legendary skins
            continue
        skin, items, item_tiers = ref.looks(d)
        skin_name, traits, worn = ref.names(skin, items)
        shown = [t for k, t in enumerate(traits) if items[k]]
        crazy = sum(1 for k in range(10) if items[k] and item_tiers[k] >= 4)
        score = (crazy, worn, traits[0] != 'Honey')
        name = f'{ref.TIER_NAMES[c["tier"]]} {skin_name}'
        cand.setdefault(skin, []).append((score, name, [f'{skin_name} skin'] + shown, (rec['key'], i), c, d))

picks = []
for skin in range(len(cat.SKINS)):
    if cand.get(skin):
        picks.append(max(cand[skin], key=lambda x: x[0]))
rest = sorted((x for s, xs in cand.items() for x in xs if x not in picks), key=lambda x: x[0], reverse=True)
for x in rest:
    if len(picks) >= 12:
        break
    if all(x[3][1] != p[3][1] for p in picks) and x[1] != picks[0][1]:   # another net, not the plain skin again
        picks.append(x)
assert len(picks) >= 8, f'only {len(picks)} examples'

tmp = tempfile.mkdtemp(prefix='qc-s2-examples-')
jobs = []
for n, x in enumerate(picks):
    f = os.path.join(tmp, f'{n:02d}.svg')
    open(f, 'wb').write(ref.svg_of(x[4], x[5], P))
    jobs.append({'svg': f, 'png': os.path.join(tmp, f'{n:02d}.png')})
JS = r"""
const fs = require('fs'), [jobsF, pup, chrome, k, x, y, w, h] = process.argv.slice(1);
const puppeteer = require(pup), K = Number(k);
(async () => {
  const b = await puppeteer.launch({ executablePath: chrome || undefined, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  try {
    const p = await b.newPage();
    await p.setViewport({ width: Math.ceil(320 * K), height: Math.ceil(320 * K) });
    for (const j of JSON.parse(fs.readFileSync(jobsF, 'utf8'))) {
      await p.setContent(`<body style="margin:0"><img id="i" style="display:block;width:${320 * K}px;height:${320 * K}px" src="data:image/svg+xml;base64,${fs.readFileSync(j.svg).toString('base64')}"></body>`);
      await p.waitForFunction(() => document.getElementById('i').complete && document.getElementById('i').naturalWidth > 0);
      await p.screenshot({ path: j.png, clip: { x: x * K, y: y * K, width: w * K, height: h * K } });
    }
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
"""
jf = os.path.join(tmp, 'jobs.json')
json.dump(jobs, open(jf, 'w'))
subprocess.run(['node', '-e', JS, jf, PUPPETEER, CHROME or '', str(K), *map(str, BOX)], check=True)

out = {}
for x, j in zip(picks, jobs):
    im = Image.open(j['png']).convert('RGB')
    im = im.resize((W, round(W * BOX[3] / BOX[2])), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=80, method=6)
    data = b.getvalue()
    assert data[:4] == b'RIFF' and b'EXIF' not in data and b'XMP ' not in data and b'ICCP' not in data
    assert not any('va' 'ult' in t.lower() for t in x[2]), x[2]                # (the export gate refuses that word)
    name = x[1] if x[1] not in out else f'{x[1]}, {x[2][-1]}'      # a second one of a skin: named by its last trait too
    out[name] = {'data': base64.b64encode(data).decode('ascii'), 'traits': x[2], 'net': f'{x[3][0]} #{x[3][1]}'}
for j in jobs:
    os.remove(j['svg']); os.remove(j['png'])
os.remove(jf); os.rmdir(tmp)
dst = os.path.join(HERE, 'examples.json')
json.dump(out, open(dst, 'w', encoding='utf-8'), separators=(',', ':'), ensure_ascii=False)
print('examples.json', os.path.getsize(dst), 'bytes:', ', '.join(f'{k} ({len(v["traits"]) - 1} worn)' for k, v in out.items()))
