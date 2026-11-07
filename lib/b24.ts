// 2.2 · Bitrix24: REST от имени приложения (auth из фрейма) и через настроечный вебхук (B24_WEBHOOK на сервере, в логи не пишем)
const ALLOWED = () => (process.env.B24_DOMAINS || 'getsestate.bitrix24.ae').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)

export const domainOk = (d: string) => ALLOWED().includes(d.trim().toLowerCase())

async function post(url: string, params: Record<string, unknown>) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params), cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (j.error) throw new Error(`b24 ${j.error}: ${String(j.error_description || '').slice(0, 120)}`)
  return j.result
}

// Вызов от имени пользователя или приложения: auth — AUTH_ID из POST фрейма или установки
export async function restApp<T = any>(domain: string, auth: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!domainOk(domain)) throw new Error('b24 domain not allowed')
  return post(`https://${domain}/rest/${method}.json`, { ...params, auth })
}

// Вызов через входящий вебхук (чтение сделок и контактов для связи с клиентом портала)
export async function restHook<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const wh = process.env.B24_WEBHOOK
  if (!wh) throw new Error('B24_WEBHOOK не задан')
  return post(wh.replace(/\/+$/, '') + '/' + method + '.json', params)
}

export const hookOn = () => !!process.env.B24_WEBHOOK

// Телефон и e-mail контакта Bitrix24 → те же нормализации, что у клиентов портала
export function contactKeys(c: { PHONE?: { VALUE: string }[]; EMAIL?: { VALUE: string }[] }) {
  const phone = (c.PHONE || []).map((p) => p.VALUE).find(Boolean) || ''
  const email = (c.EMAIL || []).map((e) => e.VALUE).find(Boolean) || ''
  return { phone, email, phoneNorm: phone.replace(/\D/g, '').replace(/^00/, ''), emailNorm: email.trim().toLowerCase() }
}

// Вкладки модуля (§12): Units в сделке и контакте, Selection в лиде; привязываем только недостающие
const TABS: [string, string][] = [['CRM_DEAL_DETAIL_TAB', 'Units'], ['CRM_CONTACT_DETAIL_TAB', 'Units'], ['CRM_LEAD_DETAIL_TAB', 'Selection']]
// 2.2 · Пункты GetsEstate в левом меню Bitrix24 (решение 242): набор по роли проверяет портал при открытии
export const MENU: Record<string, [string, string, string[]]> = {
  catalog: ['Catalog', '/catalog', ['owner', 'market_head', 'seller', 'office', 'finance', 'content']],
  backoffice: ['Back office', '/registrations', ['owner', 'office', 'market_head']],
  partners: ['Partners', '/admin/agents', ['owner', 'market_head']],
  reports: ['Reports', '/reports', ['owner', 'market_head']],
  money: ['Money', '/finance', ['owner', 'finance', 'market_head']],
  content: ['Content', '/news', ['owner', 'content']],
  settings: ['Settings', '/admin', ['owner', 'market_head', 'finance']],
}
export async function ensurePlacements(domain: string, auth: string, handler: string) {
  const have = (await restApp<{ placement: string; handler: string }[]>(domain, auth, 'placement.get')) || []
  const done: string[] = []
  for (const [p, title] of TABS) {
    if (have.some((x) => x.placement === p && x.handler === handler)) continue
    await restApp(domain, auth, 'placement.bind', { PLACEMENT: p, HANDLER: handler, TITLE: title, LANG_ALL: { en: { TITLE: title }, ru: { TITLE: title }, de: { TITLE: title } } })
    done.push(p)
  }
  // левое меню: по пункту на раздел; Bitrix24 показывает их всем с доступом к приложению, раздел проверяет роль
  for (const [k, [title]] of Object.entries(MENU)) {
    const h = `${handler}?go=${k}`
    if (have.some((x) => x.placement === 'LEFT_MENU' && x.handler === h)) continue
    try { await restApp(domain, auth, 'placement.bind', { PLACEMENT: 'LEFT_MENU', HANDLER: h, TITLE: title, LANG_ALL: { en: { TITLE: title }, ru: { TITLE: title }, de: { TITLE: title } } }); done.push('LEFT_MENU:' + k) } catch { /* встройка недоступна на тарифе */ }
  }
  // роботы приложения (§12): «Запросить бронь», «Снять бронь», «Отправить подборку», «Проверить квартиру» — в сделках
  const bots = ((await restApp<{ [k: string]: string } | string[]>(domain, auth, 'bizproc.robot.list').catch(() => [])) as string[]) || []
  for (const r of ROBOTS) {
    if (Array.isArray(bots) && bots.includes(r.CODE)) continue
    try { await restApp(domain, auth, 'bizproc.robot.add', { ...r, HANDLER: handler.replace(/\/b24$/, '/api/b24/robot'), AUTH_USER_ID: 1, USE_SUBSCRIPTION: 'Y', DOCUMENT_TYPE: ['crm', 'CCrmDocumentDeal', 'DEAL'] }); done.push('robot:' + r.CODE) } catch { /* нет права bizproc */ }
  }
  return done
}
const P = (name: string, req = false) => ({ Name: { en: name, ru: name, de: name }, Type: 'string', Required: req ? 'Y' : 'N', Multiple: 'N' })
const ROBOTS = [
  { CODE: 'ge_check_unit', NAME: { en: 'GetsEstate: check unit', ru: 'GetsEstate: проверить квартиру', de: 'GetsEstate: Wohnung prüfen' }, PROPERTIES: { UNIT: P('Unit No. (e.g. A-705)', true) },
    RETURN_PROPERTIES: { AVAILABLE: { ...P('Available (Y/N)'), Type: 'bool' }, STATUS: P('Status'), PRICE: { ...P('List price, USD'), Type: 'double' } } },
  { CODE: 'ge_request_booking', NAME: { en: 'GetsEstate: request reservation', ru: 'GetsEstate: запросить бронь', de: 'GetsEstate: Reservierung anfragen' }, PROPERTIES: { UNIT: P('Unit No.', true), DISCOUNT: { ...P('Discount %'), Type: 'double' } },
    RETURN_PROPERTIES: { RESULT: P('Result') } },
  { CODE: 'ge_release_booking', NAME: { en: 'GetsEstate: release reservation', ru: 'GetsEstate: снять бронь', de: 'GetsEstate: Reservierung freigeben' }, PROPERTIES: { UNIT: P('Unit No. (empty — all holds and requests)') },
    RETURN_PROPERTIES: { RESULT: P('Result') } },
  { CODE: 'ge_send_selection', NAME: { en: 'GetsEstate: send selection', ru: 'GetsEstate: отправить подборку', de: 'GetsEstate: Auswahl senden' }, PROPERTIES: { UNITS: P('Units, comma-separated', true) },
    RETURN_PROPERTIES: { LINK: P('Selection link') } },
]

