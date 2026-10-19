"""Run with `python scripts/check_logo.py` to verify shipped logo assets."""

import hashlib
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
GOLD = (255, 214, 0)
WHITE = (255, 255, 255)
BACKGROUND = (11, 13, 18)

# Preserve original artwork coverage, including antialiased transparent edges.
ALPHA_HASHES = {
    'kantahulay_logo_transparent.png': 'ba3db87413c29ca12000fea55b4df323ad1032c76eb4dbf116bbb34d0611b9f6',
    'android-icon-foreground.png': '92c0f0c1bbd54919834f3ca1352789fa86e8ae3c16a5004939a029ffa6f02d9a',
}
for name, digest in ALPHA_HASHES.items():
    image = Image.open(ROOT / 'assets' / name).convert('RGBA')
    assert hashlib.sha256(image.getchannel('A').tobytes()).hexdigest() == digest, name

resources = ROOT / 'android/app/src/main/res'
artwork = [ROOT / 'assets' / name for name in ALPHA_HASHES]
artwork += sorted(resources.glob('mipmap-*/ic_launcher_foreground.webp'))
artwork += sorted(resources.glob('drawable-*/splashscreen_logo.png'))
assert len(artwork) == 12, 'Missing source, launcher, or splash artwork'
for path in artwork:
    image = Image.open(path).convert('RGBA')
    pixels = image.tobytes()
    colors = {tuple(pixels[i:i + 3]) for i in range(0, len(pixels), 4) if pixels[i + 3]}
    assert colors == {GOLD, WHITE}, f'{path.name}: artwork must use only gold and white'
    if 'foreground' in path.name:
        center = image.width / 2
        radius = image.width * 33 / 108
        for index, alpha in enumerate(image.getchannel('A').tobytes()):
            if alpha:
                x, y = index % image.width, index // image.width
                assert (x + 0.5 - center) ** 2 + (y + 0.5 - center) ** 2 <= radius ** 2, path

logo = Image.open(ROOT / 'assets/kantahulay_logo_transparent.png')
for position, color in [((300, 700), GOLD), ((490, 510), GOLD), ((750, 280), WHITE)]:
    offset = (position[1] * logo.width + position[0]) * 4
    assert tuple(logo.tobytes()[offset:offset + 3]) == color, f'Incorrect logo region at {position}'

foreground = Image.open(ROOT / 'assets/android-icon-foreground.png').convert('RGBA')
background = Image.open(ROOT / 'assets/android-icon-background.png').convert('RGB')
assert background.getextrema() == tuple((channel, channel) for channel in BACKGROUND)
expected = Image.alpha_composite(background.convert('RGBA'), foreground).convert('RGB')
for name in ['icon.png', 'splash-icon.png']:
    image = Image.open(ROOT / 'assets' / name).convert('RGB')
    assert image.size == (1024, 1024), name
    assert ImageChops.difference(image, expected).getbbox() is None, name

print(f'PASS: {len(artwork)} logo layers; original transparency; adaptive safe zones; matching icon/splash backgrounds')
