// Минимальный xlsx без внешних библиотек (М10): листы со строками и числами, первая строка — жирная шапка.
import PizZip from 'pizzip'

type Cell = string | number | null | undefined
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const col = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s }
function sheetXml(rows: Cell[][]) {
  // ширина колонок — по самому длинному значению (от 8 до 40 знаков)
  const widths = (rows[0] || []).map((_, ci) => Math.min(40, Math.max(8, ...rows.map((r) => String(r[ci] ?? '').length + 2))))
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = col(ci) + (ri + 1), st = ri === 0 ? ' s="1"' : ''
    if (v == null || v === '') return `<c r="${ref}"${st}/>`
    return typeof v === 'number' && Number.isFinite(v) ? `<c r="${ref}"${st || (Math.abs(v) >= 1000 ? ' s="2"' : '')}><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`
  }).join('')}</row>`).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`
}
export function makeXlsx(sheets: { name: string; rows: Cell[][] }[]): Buffer {
  const z = new PizZip()
  z.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  z.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  z.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  z.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  z.file('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)
  sheets.forEach((s, i) => z.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)))
  return z.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
}

// Чтение первого листа xlsx (М13, импорт клиентов): строки как массивы строк; общие строки и inline-строки, числа как есть
export function readXlsx(buf: Buffer): string[][] {
  const z = new PizZip(buf)
  const shared = (z.file('xl/sharedStrings.xml')?.asText() || '').match(/<si>[\s\S]*?<\/si>/g)?.map((si) => (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')) || []
  // первая вкладка по порядку в workbook.xml (имя файла листа может не совпадать с порядком вкладок)
  const rid = (z.file('xl/workbook.xml')?.asText() || '').match(/<sheet [^>]*r:id="([^"]+)"/)?.[1]
  const target = rid ? (z.file('xl/_rels/workbook.xml.rels')?.asText() || '').match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] || (z.file('xl/_rels/workbook.xml.rels')?.asText() || '').match(new RegExp(`<Relationship [^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : null
  const sheetPath = target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '')) : Object.keys(z.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).sort()[0]
  if (!sheetPath) return []
  const un = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  const rows: string[][] = []
  for (const r of z.file(sheetPath)!.asText().match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const out: string[] = []
    for (const c of r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []) {
      const ref = c.match(/r="([A-Z]+)\d+"/)?.[1] || ''
      const ci = ref.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
      const type = c.match(/ t="(\w+)"/)?.[1]
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1]
      const val = type === 's' ? shared[Number(v)] ?? '' : type === 'inlineStr' ? (c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1] || '') : v ?? ''
      out[ci >= 0 ? ci : out.length] = un(val).trim()
    }
    rows.push(Array.from(out, (x) => x ?? ''))
  }
  return rows
}
