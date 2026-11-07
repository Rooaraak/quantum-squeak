"""Season 2 prizes row: one head-and-shoulders portrait per skin (a 560 px square from x 166, y 236 of the 896x1200
paintings, the honey face), 128x128 WebP without metadata, into wheel/art/s2/skins.json [[[skin, base64 webp], ...] per
tier], in the order of the Season 2 skin lists:
Common plain; Uncommon tiger, calico, starry; Rare circuit, chrome; Epic crystal, galaxy, ghost; Legendary gold, rainbow.
  python3 wheel/art/s2/make_skins.py <folder with body-honey.png and skin-<name>-honey.png (896x1200 RGBA)>"""
import base64, io, json, os, sys
from PIL import Image

src = sys.argv[1] if len(sys.argv) > 1 else '.'
TIERS = [['plain'], ['tiger', 'calico', 'starry'], ['circuit', 'chrome'], ['crystal', 'galaxy', 'ghost'], ['gold', 'rainbow']]
X, Y, S, OUT = 166, 236, 560, 128


def head(name):
    f = os.path.join(src, 'body-honey.png' if name == 'plain' else f'skin-{name}-honey.png')
    im = Image.open(f).convert('RGBA')
    assert im.size == (896, 1200), (f, im.size)
    im = im.crop((X, Y, X + S, Y + S)).resize((OUT, OUT), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'WEBP', quality=80, method=6)             # no exif / icc / xmp: nothing but the picture
    data = b.getvalue()
    assert data[:4] == b'RIFF' and b'EXIF' not in data and b'XMP ' not in data and b'ICCP' not in data, name
    return base64.b64encode(data).decode('ascii')


out = [[[n, head(n)] for n in t] for t in TIERS]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'skins.json')
json.dump(out, open(dst, 'w'), separators=(',', ':'))
print('skins.json', os.path.getsize(dst), 'bytes,', sum(len(t) for t in TIERS), 'skins in', len(TIERS), 'tiers')
