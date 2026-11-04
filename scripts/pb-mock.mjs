// Заглушка Profitbase API v4 для проверки синхронизации до получения ключа (М1–М3).
// node scripts/pb-mock.mjs <fixture.json> [порт=3099]. Фикстура: { projects: [...], houses: [...], properties: [...], statuses: [...], floors: { "<houseId>": [...] } }
// в формате ответов developer.profitbase.ru. Смена статуса (POST /properties/{id}/status-change) пишется в фикстуру — следующая синхронизация её увидит.
// Правка цены для проверки: поменять price.value в фикстуре — сервер перечитывает файл на каждый запрос.
import http from 'node:http'
import fs from 'node:fs'

const file = process.argv[2], port = Number(process.argv[3] || 3099)
const KEY = process.env.PB_MOCK_KEY || 'app-mock-key'
const TOKEN = 'mock-token-' + Math.random().toString(36).slice(2)
const load = () => JSON.parse(fs.readFileSync(file, 'utf8'))
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/api\/v4\/json/, '')
  let body = ''; for await (const ch of req) body += ch
  if (p === '/authentication' && req.method === 'POST') {
    const j = JSON.parse(body || '{}')
    return j?.credentials?.pb_api_key === KEY ? send(res, 200, { access_token: TOKEN, remaining_time: 86400, lang: 'ru' }) : send(res, 403, { error: 'Not allowed.', lang: 'ru' })
  }
  if (u.searchParams.get('access_token') !== TOKEN) return send(res, 403, { error: { code: 403, message: 'Forbidden' } })
  const d = load()
  const arr = (k) => u.searchParams.getAll(k + '[]').concat(u.searchParams.getAll(k)).filter(Boolean)
  if (p === '/projects') return send(res, 200, d.projects)
  if (p === '/house') { const pid = u.searchParams.get('projectId'); return send(res, 200, { success: true, data: d.houses.filter((h) => !pid || String(h.projectId) === pid) }) }
  if (p === '/custom-status/list') return send(res, 200, d.statuses)
  if (p === '/floor') return send(res, 200, (d.floors || {})[u.searchParams.get('houseId')] || [])
  if (p === '/property') {
    const pid = u.searchParams.get('projectId'), hid = arr('houseId'), off = Number(u.searchParams.get('offset') || 0), lim = Math.min(Number(u.searchParams.get('limit') || 100), u.searchParams.get('full') === 'true' ? 100 : 1000)
    const list = d.properties.filter((x) => (!pid || String(x.projectId) === pid) && (!hid.length || hid.includes(String(x.house_id))))
    return send(res, 200, { status: 'success', data: list.slice(off, off + lim) })
  }
  const m = p.match(/^\/properties\/(\d+)\/status-change$/)
  if (m && req.method === 'POST') {
    const j = JSON.parse(body || '{}'), x = d.properties.find((y) => String(y.id) === m[1])
    if (!x) return send(res, 404, { error: { code: 404, message: 'Not found' } })
    const s = d.statuses.find((y) => y.alias === j.status || String(y.id) === String(j.status))
    if (!s && !['AVAILABLE', 'BOOKED', 'SOLD', 'UNAVAILABLE'].includes(j.status)) return send(res, 400, { error: { code: 400, message: 'Unknown status' } })
    x.status = s ? s.baseStatus : j.status; x.customStatusId = s ? Number(s.id) : null
    fs.writeFileSync(file, JSON.stringify(d, null, 1))
    return send(res, 200, { id: x.id, status: j.status })
  }
  send(res, 404, { error: { code: 404, message: 'Unknown method ' + p } })
}).listen(port, '127.0.0.1', () => console.log('pb-mock on', port))
