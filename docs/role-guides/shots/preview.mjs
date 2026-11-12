// node preview.mjs <lang> out.png id1 id2 ... — снимки с нарисованными рамками целей (2 в ряд)
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [,, lang, out, ...ids] = process.argv
const bx = JSON.parse(fs.readFileSync(`out/${lang}/boxes.json`, 'utf8'))
const k = 680 / 1280
const html = `<body style="margin:0;background:#666;display:grid;grid-template-columns:680px 680px;gap:8px;font:12px sans-serif;color:#fff">${ids.map(id => `<div><div>${id}</div><div style="position:relative;width:680px;height:${820 * k}px;background:url(data:image/png;base64,${fs.readFileSync(`out/${lang}/${id}.png`).toString('base64')}) 0 0/680px auto">${(bx[id] || []).map((b, i) => b ? `<div style="position:absolute;left:${b.x * k - 2}px;top:${b.y * k - 2}px;width:${b.w * k + 4}px;height:${b.h * k + 4}px;border:2px solid #e0602a;border-radius:4px"></div><div style="position:absolute;left:${b.x * k - 9}px;top:${b.y * k - 9}px;width:16px;height:16px;border-radius:8px;background:#e0602a;font:bold 10px/16px sans-serif;text-align:center">${i + 1}</div>` : '').join('')}</div></div>`).join('')}</body>`
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' })
const pg = await br.newPage(); await pg.setViewport({ width: 1368, height: 300 })
await pg.setContent(html); await pg.screenshot({ path: out, fullPage: true }); await br.close()
