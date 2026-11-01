"""Generate Arbor logo assets (SVG source + raster icons) from one geometry.

Usage: python branding/make-logo.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
S = 1024  # design canvas

# Background gradient (top-left -> bottom-right)
BG_TOP = (18, 58, 54)      # deep teal
BG_BOTTOM = (34, 120, 92)  # forest green
DEV_TOP = (60, 42, 92)     # dev channel: purple
DEV_BOTTOM = (112, 70, 150)
LINE = (255, 255, 255)
RADIUS = 230               # corner radius
STROKE = 58
NODE_R = 62
NODE_STROKE = 26

# Git-tree geometry: trunk + three branches, commits as nodes
TRUNK = [(512, 860), (512, 560)]
BRANCHES = [
    [(512, 600), (512, 250)],                    # main (center)
    [(512, 640), (330, 470), (330, 360)],        # left branch
    [(512, 560), (700, 400), (700, 300)],        # right branch
]
NODES = [
    ((512, 250), (255, 181, 71)),   # amber
    ((330, 360), (252, 109, 38)),   # coral (GitLab-ish orange)
    ((700, 300), (124, 224, 179)),  # mint
    ((512, 840), (255, 255, 255)),  # root commit
]


def svg(top, bottom):
    def hexc(c):
        return '#%02x%02x%02x' % c

    paths = []
    for pts in [TRUNK] + BRANCHES:
        d = 'M' + ' L'.join(f'{x} {y}' for x, y in pts)
        paths.append(
            f'<path d="{d}" fill="none" stroke="{hexc(LINE)}" '
            f'stroke-width="{STROKE}" stroke-linecap="round" stroke-linejoin="round"/>'
        )
    nodes = [
        f'<circle cx="{x}" cy="{y}" r="{NODE_R}" fill="{hexc(c)}" '
        f'stroke="{hexc(LINE)}" stroke-width="{NODE_STROKE}"/>'
        for (x, y), c in NODES
    ]
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S} {S}" width="{S}" height="{S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{hexc(top)}"/>
      <stop offset="1" stop-color="{hexc(bottom)}"/>
    </linearGradient>
  </defs>
  <rect width="{S}" height="{S}" rx="{RADIUS}" fill="url(#bg)"/>
  {chr(10).join('  ' + p for p in paths).strip()}
  {chr(10).join('  ' + n for n in nodes).strip()}
</svg>
'''


def raster(top, bottom, size=1024, ss=4):
    W = size * ss
    k = W / S
    # diagonal gradient
    grad = Image.new('RGB', (W, W))
    gpx = grad.load()
    small = Image.new('RGB', (256, 256))
    spx = small.load()
    for y in range(256):
        for x in range(256):
            t = (x + y) / 510
            spx[x, y] = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    grad = small.resize((W, W), Image.BILINEAR)

    mask = Image.new('L', (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], RADIUS * k, fill=255)
    img = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    sw = int(STROKE * k)
    for pts in [TRUNK] + BRANCHES:
        sp = [(x * k, y * k) for x, y in pts]
        d.line(sp, fill=LINE, width=sw, joint='curve')
        for x, y in (sp[0], sp[-1]):
            d.ellipse([x - sw / 2, y - sw / 2, x + sw / 2, y + sw / 2], fill=LINE)
    for (x, y), c in NODES:
        x, y = x * k, y * k
        ro = (NODE_R + NODE_STROKE / 2) * k
        ri = (NODE_R - NODE_STROKE / 2) * k
        d.ellipse([x - ro, y - ro, x + ro, y + ro], fill=LINE)
        d.ellipse([x - ri, y - ri, x + ri, y + ri], fill=c)
    return img.resize((size, size), Image.LANCZOS)


def write_channel(name, top, bottom):
    out = ROOT / 'app' / 'static' / 'logos' / name
    big = raster(top, bottom, 1024)
    big.save(out / 'icon-logo.ico', sizes=[(16, 16), (32, 32), (48, 48), (128, 128), (256, 256)])
    big.save(out / 'icon-logo-legacy.icns')
    return big


def glyph_svg():
    """The tree alone, in white, as a layer for macOS Icon Composer (.icon)."""
    paths = []
    for pts in [TRUNK] + BRANCHES:
        d = 'M' + ' L'.join(f'{x} {y}' for x, y in pts)
        paths.append(
            f'<path d="{d}" stroke="white" stroke-width="{STROKE}" '
            'stroke-linecap="round" stroke-linejoin="round"/>'
        )
    nodes = [
        f'<circle cx="{x}" cy="{y}" r="{NODE_R + NODE_STROKE / 2}" fill="white"/>'
        for (x, y), _ in NODES
    ]
    return (
        f'<svg width="{S}" height="{S}" viewBox="0 0 {S} {S}" fill="none" '
        'xmlns="http://www.w3.org/2000/svg">\n  '
        + '\n  '.join(paths + nodes)
        + '\n</svg>\n'
    )


def write_mac_icon(name, top, bottom):
    """Point the macOS 26 .icon bundle at the Arbor glyph and colours."""
    import json

    bundle = ROOT / 'app' / 'static' / 'logos' / name / 'icon-logo.icon'
    (bundle / 'Assets' / '1 – Layer 3.svg').write_text(glyph_svg(), encoding='utf-8')
    config = json.loads((bundle / 'icon.json').read_text(encoding='utf-8'))
    srgb = lambda c: 'srgb:' + ','.join(f'{v / 255:.5f}' for v in c) + ',1.00000'
    config['fill']['linear-gradient'] = [srgb(bottom), srgb(top)]
    for group in config['groups']:
        for layer in group['layers']:
            if layer.get('name') == 'octocat':
                layer['name'] = 'arbor'
    (bundle / 'icon.json').write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')


def write_about_logos(prod):
    """The 64pt @2x logos of the About dialog (macOS and Windows variants)."""
    common = ROOT / 'app' / 'static' / 'common'
    small = prod.resize((128, 128), Image.LANCZOS)
    small.save(common / 'logo-64x64@2x.png')
    small.save(common / 'windows-logo-64x64@2x.png')


def write_installer_splash(prod):
    """The Windows installer splash: the logo fading in on a dark background."""
    size = 400
    logo = prod.resize((200, 200), Image.LANCZOS)
    frames = []
    for alpha in (0.25, 0.5, 0.75, 1.0):
        frame = Image.new('RGBA', (size, size), (36, 41, 46, 255))
        faded = logo.copy()
        faded.putalpha(faded.getchannel('A').point(lambda a: int(a * alpha)))
        frame.alpha_composite(faded, (100, 100))
        frames.append(frame.convert('P', palette=Image.ADAPTIVE))
    frames[0].save(
        ROOT / 'app' / 'static' / 'logos' / 'win32-installer-splash.gif',
        save_all=True,
        append_images=frames[1:],
        duration=[200, 200, 200, 2000],
        loop=0,
    )


def main():
    brand = ROOT / 'branding'
    (brand / 'arbor-logo.svg').write_text(svg(BG_TOP, BG_BOTTOM), encoding='utf-8')
    (brand / 'arbor-logo-dev.svg').write_text(svg(DEV_TOP, DEV_BOTTOM), encoding='utf-8')
    (brand / 'arbor-glyph.svg').write_text(glyph_svg(), encoding='utf-8')
    prod = write_channel('prod', BG_TOP, BG_BOTTOM)
    write_channel('dev', DEV_TOP, DEV_BOTTOM)
    write_mac_icon('prod', BG_TOP, BG_BOTTOM)
    write_mac_icon('dev', DEV_TOP, DEV_BOTTOM)
    write_about_logos(prod)
    write_installer_splash(prod)
    prod.resize((512, 512), Image.LANCZOS).save(ROOT / 'app' / 'static' / 'linux' / 'icon-logo.png')
    prod.save(brand / 'arbor-logo-1024.png')
    print('Arbor logo assets generated.')


if __name__ == '__main__':
    main()
