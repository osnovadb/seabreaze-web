// Снимки для инструкций: node shoot.mjs <lang> [shotId...] → out/<lang>/<id>.png + out/<lang>/boxes.json
// Только просмотр страниц QA-экземпляра (:3043): ничего не нажимаем, кроме вкладок; строки тестов «QA …» прячем в кадре.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const [,, lang, ...only] = process.argv
const plan = JSON.parse(fs.readFileSync('plan.json', 'utf8'))
const DICT = JSON.parse(fs.readFileSync(`../../../lib/dict/${lang}.json`, 'utf8'))
const tr = (k) => DICT[k] ?? k
const B = 'http://localhost:3043', W = 1280, H = 820
fs.mkdirSync(`out/${lang}`, { recursive: true })
const boxesFile = `out/${lang}/boxes.json`
const boxes = fs.existsSync(boxesFile) ? JSON.parse(fs.readFileSync(boxesFile, 'utf8')) : {}
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' })
let cur = null, pg = null
for (const s of plan.shots) {
  if (only.length && !only.includes(s.id)) continue
  if (cur !== s.role) {
    if (pg) await pg.close()
    pg = await (await br.createBrowserContext()).newPage()
    await pg.setViewport({ width: W, height: H, deviceScaleFactor: 2 })
    pg.on('dialog', d => d.dismiss())
    await pg.setCookie({ name: 'ge_lang', value: lang, domain: 'localhost', path: '/' })
    await pg.goto(`${B}/dev/login?as=${encodeURIComponent(plan.users[s.role])}&to=/`, { waitUntil: 'networkidle2', timeout: 40000 })
    cur = s.role
  }
  try {
    let path = s.path
    if (path === 'UNIT') { await pg.goto(B + '/catalog', { waitUntil: 'networkidle2', timeout: 40000 }); path = await pg.evaluate(() => document.querySelector('a[href^="/units/"]')?.getAttribute('href') || '/catalog') }
    await pg.goto(B + path, { waitUntil: 'networkidle2', timeout: 40000 })
    if (s.click) {
      const lbl = tr(s.click)
      const ok = await pg.evaluate((l) => { const el = [...document.querySelectorAll('a, button')].find(e => !e.closest('aside') && e.textContent.trim().startsWith(l)); if (el) { el.click(); return true } return false }, lbl)
      if (ok) { await new Promise(r => setTimeout(r, 1500)); try { await pg.waitForNetworkIdle({ timeout: 8000 }) } catch {} }
    }
    await new Promise(r => setTimeout(r, 700))
    await pg.evaluate(() => {
      // прячем строки автотестов и строки с почтой не из тестовых доменов (реальные заявители), маскируем телефоны
      const QA = /QA\s|QA\d|QA[A-Z]{2}\b|qa\.test|gclid=QA/
      const MAIL = /[\w.+-]+@([\w-]+\.)+[a-z]{2,}(?![a-z])/g
      const okMail = (m) => /@(example\.(com|de|org)|demo\.getsestate|qa\.test)$/i.test(m)
      document.querySelectorAll('option').forEach(o => { if (QA.test(o.textContent)) o.textContent = 'Anna Schmidt' })
      document.querySelectorAll('tr, li, .kcard, [draggable], a[href^="/clients/"]').forEach(el => {
        if (el.querySelector('button, select, input:not([type=checkbox]), textarea')) return
        const t = el.innerText || el.textContent || ''
        if (t.length > 600) return
        if (QA.test(t) || (t.match(MAIL) || []).some(m => !okMail(m))) el.style.display = 'none'
      })
      document.querySelectorAll('option').forEach(o => { if (QA.test(o.textContent)) o.textContent = 'Anna Schmidt' })
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n; (n = w.nextNode());) {
        if (/\+\d[\d\s-]{7,}/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/(\+\d{2,3})[\d\s-]{6,}/g, '$1 ••• ••• ••')
        if (QA.test(n.nodeValue) && n.nodeValue.length < 60) n.nodeValue = n.nodeValue.replace(/QA[\w\s]*/, 'Anna Schmidt')
      }
    })
    const find = async () => pg.evaluate((targets) => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden' }
      const inScope = (e, w) => w === 'nav' ? !!e.closest('aside') : w === 'main' ? !e.closest('aside') : true
      return targets.map((t) => {
        let el = null
        if (t.sel) el = [...document.querySelectorAll(t.sel)].find(e => vis(e) && !e.closest('aside') && !e.closest('tr[style*="none"]'))
        else {
          const norm = (x) => x.replace(/\s+/g, ' ').trim()
          const cands = [...document.body.querySelectorAll('a, button, label, summary, h1, h2, h3, h4, th, td, span, div, b, strong, option')].filter(e => vis(e) && inScope(e, t.within))
          const exact = cands.filter(e => norm(e.textContent) === t.label)
          const pre = cands.filter(e => norm(e.textContent).startsWith(t.label))
          const pick = (arr) => arr.sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return ra.width * ra.height - rb.width * rb.height })[0]
          el = pick(exact) || pick(pre)
          if (el && el.tagName === 'OPTION') el = el.closest('select')
        }
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height }
      })
    }, s.t.map(t => ({ sel: t.sel, within: t.within, label: t.key ? tr(t.key) : null })))
    let bx = await find()
    const maxY = Math.max(0, ...bx.filter(Boolean).map(b => b.y + b.h))
    let sy = 0
    if (maxY > H - 20) { sy = Math.min(maxY - H + 60, Math.max(0, Math.min(...bx.filter(Boolean).map(b => b.y)) - 80)); await pg.evaluate(y => scrollTo(0, y), sy); await new Promise(r => setTimeout(r, 300)) }
    await pg.screenshot({ path: `out/${lang}/${s.id}.png` })
    boxes[s.id] = bx.map(b => b && ({ x: Math.round(b.x), y: Math.round(b.y - sy), w: Math.round(b.w), h: Math.round(b.h) }))
    const miss = s.t.map((t, i) => bx[i] ? null : (t.key || t.sel)).filter(Boolean)
    console.log(s.id, miss.length ? 'MISSING: ' + miss.join(' | ') : 'ok')
  } catch (e) { console.log(s.id, 'FAIL', e.message) }
}
fs.writeFileSync(boxesFile, JSON.stringify(boxes, null, 1))
await br.close()
