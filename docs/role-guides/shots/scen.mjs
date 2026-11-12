// Пошаговые сценарии: node scen.mjs [scenId...] → scen/<lang>/<scen>-<n>.png + scen/boxes.json
// Каждый шаг снимается на 4 языках (перезагрузка + подготовка формы), затем один раз выполняется действие шага (do) на QA-экземпляре.
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
const only = process.argv.slice(2)
const S = JSON.parse(fs.readFileSync('scen.json', 'utf8'))
const LANGS = ['ru', 'en', 'de', 'he']
const DICT = Object.fromEntries(LANGS.map(l => [l, JSON.parse(fs.readFileSync(`../../../lib/dict/${l}.json`, 'utf8'))]))
const tr = (l, k) => {
  if (DICT[l][k] !== undefined) return DICT[l][k]
  const full = Object.keys(DICT[l]).find(x => x.startsWith(k + ' {') || x.startsWith(k + ' ↗') || x.startsWith(k + ' —') || x.startsWith(k + ' ·'))
  if (full) { const v = DICT[l][full]; const cut = v.indexOf('{'); return (cut > 0 ? v.slice(0, cut) : v.replace(/ ↗$/, '')).trim() }
  return k
}
const B = 'http://localhost:3043', W = 1280, H = 820
const V = { ...S.vars }
const sub = (s) => typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => V[k] ?? m) : s
const boxesFile = 'scen/boxes.json'
fs.mkdirSync('scen', { recursive: true }); LANGS.forEach(l => fs.mkdirSync(`scen/${l}`, { recursive: true }))
const BOX = fs.existsSync(boxesFile) ? JSON.parse(fs.readFileSync(boxesFile, 'utf8')) : {}
const br = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new' })
const pages = {}
async function pageFor(role) {
  if (pages[role]) return pages[role]
  const pg = await (await br.createBrowserContext()).newPage()
  await pg.setViewport({ width: W, height: H, deviceScaleFactor: 2 })
  pg.on('dialog', d => d.accept())
  await login(pg, role)
  return (pages[role] = pg)
}
async function login(pg, role) { await pg.setCookie({ name: 'ge_lang', value: 'ru', domain: 'localhost', path: '/' }); await pg.goto(`${B}/dev/login?as=${encodeURIComponent(S.users[role])}&to=/`, { waitUntil: 'networkidle2' }) }
const idle = async (pg) => { try { await pg.waitForNetworkIdle({ timeout: 8000 }) } catch {} ; await new Promise(r => setTimeout(r, 600)) }
const nearRows = (pg, txt) => pg.evaluateHandle((t) => { const tr = [...document.querySelectorAll('tr')].find(r => r.offsetParent && r.innerText.includes(t)); if (!tr) return null; return [tr, tr.nextElementSibling].filter(Boolean) }, txt)
async function act(pg, a, lang) {
  if (a.fill) { const els = await pg.$$(a.fill); const el = els[a.i || 0]; if (!el) return console.log('  нет поля', a.fill); const val = sub(typeof a.v === 'object' ? a.v[lang] : a.v); await el.evaluate((e, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })) }, val); await new Promise(r => setTimeout(r, 250)) }
  if (a.select) { const els = await pg.$$(a.select); const el = els[a.i || 0]; if (el) await el.select(sub(a.v)) }
  if (a.check) await pg.$eval(a.check, e => { if (!e.checked) e.click() })
  if (a.click) { const l = tr(lang, a.click); await pg.evaluate((l) => { const el = [...document.querySelectorAll('a, button, summary')].find(e => !e.closest('aside') && e.textContent.replace(/\s+/g, ' ').trim().startsWith(l)); if (el) el.click() }, l); await idle(pg) }
  if (a.clicklang) { await Promise.all([pg.waitForNavigation({ timeout: 8000 }).catch(() => {}), pg.evaluate((L) => { const el = [...document.querySelectorAll('a, button')].find(e => e.textContent.trim() === L); if (el) el.click() }, lang.toUpperCase())]); await idle(pg) }
  if (a.clicksel) { await pg.$eval(a.clicksel, e => e.click()); await idle(pg) }
  if (a.nearfill) { const ok = await pg.evaluate((t, sel, v) => { const tr = [...document.querySelectorAll('tr')].find(r => r.offsetParent && r.innerText.includes(t)); if (!tr) return false; const rows = [tr, tr.nextElementSibling].filter(Boolean); const el = rows.map(r => r.querySelector(sel)).find(Boolean); if (!el) return false; el.focus(); el.value = ''; return true }, sub(a.nearfill), a.sel, sub(a.v)); if (ok) await pg.keyboard.type(sub(a.v)) }
  if (a.neardate) { const ok = await pg.evaluate((t) => { const tr = [...document.querySelectorAll('tr')].find(r => r.offsetParent && r.innerText.includes(t)); const rows = [tr, tr?.nextElementSibling].filter(Boolean); const el = rows.map(r => r.querySelector('input[type=date]')).find(Boolean); if (!el) return false; el.focus(); return true }, sub(a.neardate)); if (ok) await pg.keyboard.type(a.v) }
  if (a.nearclick) { const l = tr(lang, a.nearclick); await pg.evaluate((t, l) => { const tr = [...document.querySelectorAll('tr')].find(r => r.offsetParent && r.innerText.includes(t)); const rows = [tr, tr?.nextElementSibling].filter(Boolean); const el = rows.flatMap(r => [...r.querySelectorAll('button, a')]).find(e => e.textContent.trim().startsWith(l)); if (el) el.click() }, sub(a.nearclick), l); await idle(pg) }
}
async function clean(pg) {
  await pg.evaluate(() => {
    const QA = /QA\s|QA\d|QA[A-Z]{2}\b|qa\.test|gclid=QA/
    const MAIL = /[\w.+-]+@([\w-]+\.)+[a-z]{2,}(?![a-z])/g
    const okMail = (m) => /@(example\.(com|de|org)|demo\.getsestate|qa\.test)$/i.test(m)
    document.querySelectorAll('option').forEach(o => { if (QA.test(o.textContent)) o.remove() })
    document.querySelectorAll('tr, li, .kcard, [draggable], a[href^="/clients/"]').forEach(el => {
      if (el.querySelector('button, select, input:not([type=checkbox]), textarea')) return
      const t = el.innerText || ''
      if (t.length > 600) return
      if (QA.test(t) || (t.match(MAIL) || []).some(m => !okMail(m))) el.style.display = 'none'
    })
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n; (n = w.nextNode());) if (/\+\d[\d\s-]{7,}/.test(n.nodeValue) && !/1500 0000/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/(\+\d{2,3})[\d\s-]{6,}/g, '$1 ••• ••• ••')
  })
}
async function boxes(pg, targets, lang) {
  return pg.evaluate((targets) => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== 'hidden' && e.offsetParent !== null || (e.type === 'checkbox' && r.width > 0) }
    const norm = (x) => x.replace(/\s+/g, ' ').trim()
    return targets.map((t) => {
      let scope = [document.body]
      if (t.near) { const tr = [...document.querySelectorAll('tr')].find(r => r.offsetParent && r.innerText.includes(t.near)); if (!tr) return null; scope = [tr, tr.nextElementSibling].filter(Boolean) }
      let el = null
      if (t.sel) {
        let list = scope.flatMap(s => [...s.querySelectorAll(t.sel)]).filter(e => vis(e) && !e.closest('aside'))
        if (t.near && t.sel === 'td') list = [scope[0].querySelector('td')]
        el = t.pick === 'last' ? list[list.length - 1] : list[t.nth || 0]
      } else if (t.label) {
        const cands = scope.flatMap(s => [...s.querySelectorAll('a, button, label, summary, h1, h2, h3, h4, th, td, span, div, b, strong, p')]).filter(e => vis(e) && (t.within === 'nav' ? e.closest('aside') : !e.closest('aside')))
        const inView = (e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight }
        const by = (f) => cands.filter(e => f(norm(e.innerText || e.textContent))).sort((a, b) => (inView(b) - inView(a))).sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return (inView(b) - inView(a)) || (ra.width * ra.height - rb.width * rb.height) })[0]
        const L = t.label.toLowerCase(); el = by(x => x.toLowerCase() === L) || by(x => x.toLowerCase().startsWith(L))
      }
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  }, targets.map(t => ({ sel: t.sel, nth: t.nth, pick: t.pick, within: t.within, near: t.near ? sub(t.near) : null, label: t.key ? tr(lang, t.key) : null })))
}
for (const sc of S.scen) {
  if (only.length && !only.includes(sc.id)) continue
  delete pages[sc.role]
  const pg = await pageFor(sc.role)
  for (let i = 0; i < sc.steps.length; i++) {
    const st = sc.steps[i], id = `${sc.id}-${i + 1}`
    // ленивые переменные: ссылка согласия и клиентский вид подборки
    if (st.go.includes('{CTOKEN}') && !V.CTOKEN) { await pg.goto(B + sub('/clients/{CID}'), { waitUntil: 'networkidle2' }); V.CTOKEN = await pg.evaluate(() => { const a = document.querySelector('a[href*="wa.me"][href*="text="]'); const m = a && decodeURIComponent(a.href).match(/\/c\/[\w-]+/); return m && m[0] }) }
    if (st.go.includes('{SVIEW}') && !V.SVIEW) { await pg.goto(B + sub('/selections/{SID}'), { waitUntil: 'networkidle2' }); V.SVIEW = await pg.evaluate(() => { const a = [...document.querySelectorAll('a')].find(e => /\/s\//.test(e.getAttribute('href') || '')); return a && new URL(a.href).pathname }) }
    for (const lang of LANGS) {
      let p = pg
      if (st.client) { p = await (await br.createBrowserContext()).newPage(); await p.setViewport({ width: W, height: H, deviceScaleFactor: 2 }) }
      await p.setCookie({ name: 'ge_lang', value: lang, domain: 'localhost', path: '/' })
      if (!st.perLang) await p.goto(B + sub(st.go), { waitUntil: 'networkidle2', timeout: 40000 })
      if (st.perLang) { await login(p, sc.role); await p.setCookie({ name: 'ge_lang', value: lang, domain: 'localhost', path: '/' }); for (const a of st.perLang) { if (a.go) await p.goto(B + sub(a.go), { waitUntil: 'networkidle2' }); else await act(p, a, lang) } }
      if (st.click) await act(p, { click: st.click }, lang)
      for (const a of st.prep || []) await act(p, a, lang)
      await clean(p)
      if (st.scroll) await p.evaluate((l) => { const el = [...document.querySelectorAll('h2, h3, h4, div, span, button, b, strong')].find(e => !e.closest('aside') && (e.textContent || '').trim().startsWith(l)); if (el) el.scrollIntoView({ block: 'start' }); scrollBy(0, -90) }, tr(lang, st.scroll))
      else {
        const bx0 = await boxes(p, st.t, lang)
        const ys = bx0.filter(Boolean).map(b => b.y + b.h)
        if (ys.length && Math.max(...ys) > H - 20) { const minY = Math.min(...bx0.filter(Boolean).map(b => b.y)); await p.evaluate((y) => scrollBy(0, y), Math.min(Math.max(...ys) - H + 60, minY - 80)) }
      }
      await new Promise(r => setTimeout(r, 300))
      const bx = await boxes(p, st.t, lang)
      await p.screenshot({ path: `scen/${lang}/${id}.png` })
      BOX[`${lang}/${id}`] = bx
      const miss = st.t.map((t, k) => bx[k] ? null : (t.key || t.sel)).filter(Boolean)
      console.log(id, lang, miss.length ? 'MISSING: ' + miss.join(' | ') : 'ok')
      if (st.client) await p.close()
    }
    if (st.do) {
      await pg.setCookie({ name: 'ge_lang', value: 'ru', domain: 'localhost', path: '/' })
      await pg.goto(B + sub(st.go), { waitUntil: 'networkidle2' })
      for (const a of st.do) await act(pg, a, 'ru')
      console.log(id, 'do →', pg.url())
    }
    if (st.after === 'relogin') await login(pg, sc.role)
    fs.writeFileSync(boxesFile, JSON.stringify(BOX, null, 1))
  }
}
await br.close()
