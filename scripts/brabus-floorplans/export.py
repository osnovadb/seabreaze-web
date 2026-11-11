# План этажей BRABUS → файлы портала и portal.floor_plans (source 'treva:brabus'; прежние планы источника заменяются)
import json, uuid, os, shutil
plans = json.load(open('out/plans.json'))
os.makedirs('upload', exist_ok=True)
sql = ["begin;",
       "create temp table old_fp as select f.id, f.file_id from portal.floor_plans f where f.source = 'treva:brabus';",
       "delete from portal.floor_plans where id in (select id from old_fp);",
       "delete from portal.files where id in (select file_id from old_fp);"]
for p in plans:
    fid = str(uuid.uuid4()); disk = fid + '.jpg'
    shutil.copy('out/' + p['file'], 'upload/' + disk); size = os.path.getsize('upload/' + disk)
    cells = json.dumps(p['cells']).replace("'", "''")
    sql.append(f"insert into portal.files (id, filename, mime, size, disk_name) values ('{fid}', 'BRABUS {p['block']} этаж {p['floor']}.jpg', 'image/jpeg', {size}, '{disk}');")
    sql.append(f"insert into portal.floor_plans (building_id, file_id, title, floor_from, floor_to, north_deg, cells, source) select b.id, '{fid}', 'Этаж {p['floor']}', {p['floor']}, {p['floor']}, 0, '{cells}'::jsonb, 'treva:brabus' from buildings b join projects p on p.id = b.project_id where p.slug = 'brabus-island-baku' and b.name = '{p['block']}';")
sql.append("commit;")
open('import.sql', 'w').write('\n'.join(sql) + '\n')
print(len(plans), 'plans')
