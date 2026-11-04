# Разбор поэтажного плана Premium Residence: красные подписи квартир → номер и площадь (tesseract на увеличенной вырезке),
# контуры квартир — между толстыми стенами ряда (над и под коридором). Результат: JSON по этажу.
import sys, json, re, subprocess, os, tempfile
import numpy as np
from PIL import Image
from scipy import ndimage

def ocr(img, wl):
    with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f: img.save(f.name)
    out = subprocess.run(['tesseract', f.name, '-', '--psm', '7', '-c', f'tessedit_char_whitelist={wl}'], capture_output=True, text=True).stdout.strip()
    os.unlink(f.name); return out

def prep(c, k):
    # серый → ч/б, увеличение, белые поля: tesseract читает мелкие цифры без линий рамки
    c = c.convert('L').resize((c.width * k, c.height * k), Image.LANCZOS).point(lambda p: 0 if p < 175 else 255)
    out = Image.new('L', (c.width + 60, c.height + 60), 255); out.paste(c, (30, 30)); return out

def labels(rgb):
    r, g, b = rgb[..., 0].astype(int), rgb[..., 1].astype(int), rgb[..., 2].astype(int)
    red = (r > 85) & (r - g > 35) & (r - b > 30)
    lab, n = ndimage.label(ndimage.binary_dilation(red, iterations=2))
    out = []
    for sl in ndimage.find_objects(lab):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if 60 < w < 260 and 40 < h < 140 and w > h: out.append((sl[1].start, sl[0].start, w, h))
    return out

def parse(path):
    im = Image.open(path).convert('RGB'); rgb = np.asarray(im); H, W = rgb.shape[:2]
    gray = np.asarray(im.convert('L'))
    res = []
    for (x, y, w, h) in labels(rgb):
        num = prep(im.crop((x + 6, y + 6, x + int(w * 0.29) - 4, y + h // 2 - 4)), 6)
        area = prep(im.crop((x + int(w * 0.31) + 4, y + 8, x + w - 6, y + h - 8)), 4)
        res.append({'x': x, 'y': y, 'w': w, 'h': h, 'num': ocr(num, '0123456789abcdefABCDEF/'), 'area': ocr(area, '0123456789.,')})
    # здание: тёмные пиксели между рядами подписей
    if not res: return {'labels': []}
    ys = sorted(l['y'] for l in res); ymid = (ys[0] + ys[-1]) / 2
    top = [l for l in res if l['y'] < ymid]; bot = [l for l in res if l['y'] >= ymid]
    y0 = max(l['y'] + l['h'] for l in top) + 10 if top else 0; y1 = min(l['y'] for l in bot) - 10 if bot else H
    dark = gray < 110
    band = dark[y0:y1]
    rows = band.mean(axis=1); cols = band.mean(axis=0)
    yy = np.where(rows > 0.02)[0]; xx = np.where(cols > 0.02)[0]
    by0, by1 = y0 + yy[0], y0 + yy[-1]; bx0, bx1 = xx[0], xx[-1]
    # коридор: самая длинная полоса строк с малой долей тёмного в средней части здания
    mid = dark[by0:by1, bx0 + (bx1 - bx0) // 5: bx1 - (bx1 - bx0) // 5].mean(axis=1)
    low = mid < 0.08; best = (0, 0); s = None
    for i, v in enumerate(list(low) + [False]):
        if v and s is None: s = i
        if not v and s is not None:
            if i - s > best[1] - best[0] and (by1 - by0) * 0.3 < s < (by1 - by0) * 0.75: best = (s, i)
            s = None
    cy0, cy1 = by0 + best[0], by0 + best[1]
    return {'W': W, 'H': H, 'bld': [int(bx0), int(by0), int(bx1), int(by1)], 'corr': [int(cy0), int(cy1)], 'labels': res}

if __name__ == '__main__':
    print(json.dumps(parse(sys.argv[1])))
