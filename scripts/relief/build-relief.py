"""Construit src/data/world-relief.bin : altitude (m) du relief terrestre et profondeur des océans,
grille équirectangulaire 4096 × 2048, entiers 16 bits signés (altitude / 4 m, terre > 0, mer < 0),
codés en différences le long de chaque ligne puis compressés (zlib).

Sources (téléchargées une fois, voir README) :
  - bathymétrie : ggOceanMapsLargeData / dd_rbathy_cont.rda (ETOPO/GEBCO, 2 minutes d'arc)
  - relief terrestre : webgl-earth / elev_bump_4k.jpg (SRTM/GTOPO, shadedrelief.com)
Les côtes sont alignées sur la carte du jeu (world-hires.bin) pour que terre et mer coïncident.
Usage : python3 scripts/relief/build-relief.py <bathy.npy> <elev_bump_4k.jpg>
"""
import sys, zlib, os
import numpy as np
from PIL import Image, ImageFilter
from scipy.ndimage import uniform_filter

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
W, H = 4096, 2048
bathy_npy, elev_jpg = sys.argv[1], sys.argv[2]

# --- masque terre/mer du jeu (8192×4096 -> 4096×2048)
hi = np.frombuffer(zlib.decompress(open(os.path.join(ROOT, 'src/data/world-hires.bin'), 'rb').read()), np.uint8).reshape(4096, 8192)
land_hi = (hi != 255).astype(np.float32)
land_frac = land_hi.reshape(H, 2, W, 2).mean(axis=(1, 3))
land = land_frac >= 0.5

# --- relief terrestre (≈ 27 m par niveau de gris au-dessus de 22)
e = np.asarray(Image.open(elev_jpg).convert('L').filter(ImageFilter.GaussianBlur(1.3)), np.float32)
if e.shape != (H, W):
    e = np.asarray(Image.fromarray(e).resize((W, H), Image.BILINEAR), np.float32)
elev = np.clip(e - 22.0, 0, None) * 27.0

# --- bathymétrie (profondeur positive, NaN sur terre) -> 4096×2048
b = np.load(bathy_npy).astype(np.float32)
valid = ~np.isnan(b)
bz = np.where(valid, b, 0).astype(np.float32)
bi = np.asarray(Image.fromarray(bz).resize((W, H), Image.BOX), np.float32)
vi = np.asarray(Image.fromarray(valid.astype(np.float32)).resize((W, H), Image.BOX), np.float32)
depth = np.where(vi > 0.01, bi / np.maximum(vi, 1e-3), 0)
# comble les mers sans donnée (côtes du jeu plus larges que la source) par diffusion depuis les voisins
missing = (~land) & (vi <= 0.01)
d = depth.copy()
for _ in range(40):
    if not missing.any():
        break
    s = uniform_filter(np.where(missing, 0, d).astype(np.float32), 5, mode='wrap')
    m = uniform_filter((~missing).astype(np.float32), 5, mode='wrap')
    fill = missing & (m > 0.05)
    d[fill] = s[fill] / m[fill]
    missing = missing & ~fill
d[missing] = 30.0

out = np.where(land, np.maximum(elev, 2.0), -np.maximum(d, 6.0))
out = np.clip(np.round(out / 4.0), -2750, 2250).astype(np.int16)   # pas de 4 m
delta = np.diff(out, axis=1, prepend=0).astype(np.int16)             # codage différentiel par ligne
raw = zlib.compress(delta.tobytes(), 9)
open(os.path.join(ROOT, 'src/data/world-relief.bin'), 'wb').write(raw)
print('relief', out.shape, 'min', out.min() * 4, 'max', out.max() * 4, 'Ko', len(raw) // 1024)
