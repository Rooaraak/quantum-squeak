"""Copies the slice of the old v9 game art that the Quantum Wheel page needs into wheel/art/art.json (so the page build
does not depend on the old studio folder): the 16 wish-board hamsters (Calm/Grin face, Party hat, Wire glasses, Scarf)
in one painted skin per hatch tier, plus the wheel and the quantum-computer pictures of the old scene.
  python3 extract_art.py <old studio folder with assets2.json and scene.json>"""
import json, os, sys

src = sys.argv[1] if len(sys.argv) > 1 else '.'
A = json.load(open(os.path.join(src, 'assets2.json')))
S = json.load(open(os.path.join(src, 'scene.json')))
FACES = ['honey', 'grin']                                   # bit 3: Calm (off) / Grin (on), as on the v9 board
SKINS = ['tiger', 'circuit', 'crystal', 'gold']             # Uncommon, Rare, Epic, Legendary (Common = the plain body)
ITEMS = ['fit-party', 'fit-glasses', 'fit-scarf']           # bit 0 hat, bit 1 glasses, bit 2 neckwear
keys = [f'body-{f}' for f in FACES] + [f'skin-{s}-{f}' for s in SKINS for f in FACES]
keys += [k + x for k in ITEMS for x in ('', '-erase', '-shadow')]
missing = [k for k in keys if k not in A['assets']]
assert not missing, missing
out = {'size': A['size'], 'anchors': {f: A['anchors'][f] for f in FACES}, 'assets': {k: A['assets'][k] for k in keys},
       'scene': {k: S[k] for k in ('wheel', 'core')}}
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'art.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('art.json', os.path.getsize(dst), 'bytes,', len(keys), 'sprites + wheel + core')
