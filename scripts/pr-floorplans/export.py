# Поэтажные планы Premium → файлы портала и floor_plans: обрезка белых полей, 3000 px по ширине, координаты контуров пересчитаны
import json, uuid, os
import numpy as np
from PIL import Image
res = json.load(open('../pr_floors/result.json'))
os.makedirs('../pr_floors/out', exist_ok=True)
sql = ['begin;', "create temp table old_fp as select f.id, f.file_id from portal.floor_plans f join buildings b on b.id = f.building_id join projects p on p.id = b.project_id where p.slug = 'premium-residence' and f.title like 'Этаж %';",
       'delete from portal.floor_plans where id in (select id from old_fp);', 'delete from portal.files where id in (select file_id from old_fp);']
for r in res:
    im = Image.open(f"../pr_floors/img/{r['blk']}-{r['floor_click']}.jpg").convert('RGB'); W, H = im.size
    g = np.asarray(im.convert('L')) < 235
    ys = np.where(g.mean(axis=1) > 0.002)[0]; xs = np.where(g.mean(axis=0) > 0.002)[0]
    x0, x1, y0, y1 = max(0, xs[0] - 20), min(W, xs[-1] + 20), max(0, ys[0] - 20), min(H, ys[-1] + 20)
    cw, ch = x1 - x0, y1 - y0
    c = im.crop((x0, y0, x1, y1)); k = min(1, 3000 / cw); c = c.resize((int(cw * k), int(ch * k)), Image.LANCZOS)
    fid = str(uuid.uuid4()); disk = fid + '.jpg'; c.save('../pr_floors/out/' + disk, quality=84, optimize=True)
    cells = [{'riser': x['riser'], 'points': [[round((px * W - x0) / cw, 4), round((py * H - y0) / ch, 4)] for px, py in x['points']]} for x in r['cells']]
    size = os.path.getsize('../pr_floors/out/' + disk)
    sql.append(f"insert into portal.files (id, filename, mime, size, disk_name) values ('{fid}', 'Premium {r['blk']} этаж {r['floor']}.jpg', 'image/jpeg', {size}, '{disk}');")
    sql.append(f"insert into portal.floor_plans (building_id, file_id, title, floor_from, floor_to, north_deg, cells) select b.id, '{fid}', 'Этаж {r['floor']}', {r['floor']}, {r['floor']}, 0, '{json.dumps(cells)}'::jsonb from buildings b join projects p on p.id = b.project_id where p.slug = 'premium-residence' and b.external_id = '{r['blk']}';")
sql.append('commit;')
open('../pr_floors/import.sql', 'w').write('\n'.join(sql) + '\n')
print(len(res), 'plans')
