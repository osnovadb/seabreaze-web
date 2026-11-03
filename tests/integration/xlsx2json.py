# xlsx → JSON (листы → строки), для интеграционных тестов. python3 xlsx2json.py file.xlsx
import json, sys, warnings
import openpyxl
with warnings.catch_warnings(record=True) as w:
    warnings.simplefilter('always')
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    out = {'sheets': {ws.title: [[c for c in r] for r in ws.iter_rows(values_only=True)] for ws in wb.worksheets}, 'warnings': [str(x.message) for x in w]}
print(json.dumps(out, ensure_ascii=False, default=str))
