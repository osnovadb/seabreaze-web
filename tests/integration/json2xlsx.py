# JSON-строки → xlsx через openpyxl (как файл из Excel/Google Sheets), для тестов импорта. python3 json2xlsx.py out.xlsx < rows.json
# {"rows": [[...], ...], "title": "лист", "first": "Пустой лист"} — first: добавить перед нужным листом другой (порядок вкладок)
import json, sys
import openpyxl
d = json.load(sys.stdin)
wb = openpyxl.Workbook()
ws = wb.active
if d.get('first'):
    ws.title = d['first']; ws.append(['не тот лист'])
    ws = wb.create_sheet(d.get('title', 'Clients'))
else:
    ws.title = d.get('title', 'Clients')
for r in d['rows']:
    ws.append(r)
wb.save(sys.argv[1])
