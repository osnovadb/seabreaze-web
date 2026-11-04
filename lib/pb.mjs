// Синхронизация с Profitbase API v4 (М1–М3, М11). Общий модуль: его зовут tick (каждые 15 минут) и кнопка «Запустить сейчас».
// q(sql, params) → rows; tx(fn(db)) — транзакция с db.query. Ключ API — только в окружении (source.config.key_env), не в базе.
// Источник: sources.kind = 'profitbase', config = { account: 'pb21387' | base_url, key_env, projects: { "<pb id>": "<наш slug>" },
//   houses: { "<pb id>": "<наш external_id корпуса>" }, reserve_status, sold_status, currency }.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function pbClient(src, q) {
  const cfg = src.config || {}
  const base = (cfg.base_url || `https://${cfg.account}.profitbase.ru`).replace(/\/$/, '') + '/api/v4/json'
  const key = process.env[cfg.key_env || ''] || ''
  let last = 0
  async function call(method, path, params, body, retry = true) {
    // Лимит Profitbase — 1 запрос в секунду на ключ
    const wait = last + 1100 - Date.now(); if (wait > 0) await sleep(wait); last = Date.now()
    const token = path === '/authentication' ? null : await auth()
    const u = new URL(base + path)
    for (const [k, v] of Object.entries(params || {})) (Array.isArray(v) ? v : [v]).forEach((x) => u.searchParams.append(Array.isArray(v) ? k + '[]' : k, String(x)))
    if (token) u.searchParams.set('access_token', token)
    const r = await fetch(u, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) })
    const j = await r.json().catch(() => ({}))
    if (r.status === 401 || r.status === 403) {
      if (token && retry) { await q(`delete from portal.kv where key = $1`, ['pb_token:' + src.id]); return call(method, path, params, body, false) }
      throw new Error(`Profitbase ${r.status}: ${JSON.stringify(j.error || j).slice(0, 160)}`)
    }
    if (!r.ok) throw new Error(`Profitbase ${r.status} ${path}: ${JSON.stringify(j).slice(0, 160)}`)
    return j
  }
  // Токен живёт 24 часа — кэшируем в portal.kv (значение — токен, срок — в updated_at + remaining_time)
  async function auth() {
    const c = (await q(`select value from portal.kv where key = $1 and updated_at > now() - interval '20 hours'`, ['pb_token:' + src.id]))[0]
    if (c) return c.value
    if (!key) throw new Error(`нет ключа API: переменная ${cfg.key_env || '(key_env не задан)'}`)
    const j = await call('POST', '/authentication', null, { type: 'api-app', credentials: { pb_api_key: key } })
    if (!j.access_token) throw new Error('Profitbase: нет access_token')
    await q(`insert into portal.kv (key, value) values ($1,$2) on conflict (key) do update set value = $2, updated_at = now()`, ['pb_token:' + src.id, j.access_token])
    return j.access_token
  }
  return { get: (p, params) => call('GET', p, params), post: (p, body) => call('POST', p, null, body) }
}

const ROOMS = (p) => (p.studio ? 1 : Number(p.rooms_amount) > 0 && Number(p.rooms_amount) < 20 ? Number(p.rooms_amount) + 1 : null) // наши «комнаты» = спальни + 1
const TYPE = (p) => (p.studio ? 'studio' : p.propertyType === 'parking' ? 'parking' : p.propertyType === 'pantry' ? 'storage' : p.typePurpose === 'commercial' ? 'commercial' : ['1br', '2br', '3br', '4br'][Math.min(3, Math.max(0, Number(p.rooms_amount || 1) - 1))])

// Прогон источника: проекты → дома → квартиры (каждые 15 минут), статусы и планы этажей (раз в сутки, или full).
export async function pbSync(q, tx, src, { full = false, notify } = {}) {
  const cfg = src.config || {}, pb = pbClient(src, q)
  const run = (await q(`insert into sync_runs (source_id) values ($1) returning id`, [src.id]))[0].id
  const st = { checked: 0, changed: 0, created: 0, gone: 0, unmatched: [], floors: 0, statuses: 0, errors: [] }
  try {
    // Статусы застройщика → наши; новый без сопоставления — «недоступно» и в список на разбор (М11)
    const daily = full || !(await q(`select 1 from sync_runs where source_id = $1 and status in ('ok','partial') and (stats->>'statuses')::int > 0 and started_at > now() - interval '1 day'`, [src.id])).length
    if (daily) {
      const ss = await pb.get('/custom-status/list')
      const list = Array.isArray(ss) ? ss : ss.data || [ss]
      const BASE = { AVAILABLE: 'available', BOOKED: 'reserved', EXECUTION: 'reserved', SOLD: 'sold', UNAVAILABLE: 'unavailable' }
      for (const s of list.filter((x) => x && x.id != null)) {
        for (const ext of [String(s.id), s.alias].filter(Boolean)) await q(`insert into status_map (source_id, external_status, status) values ($1,$2,$3) on conflict (source_id, external_status) do nothing`, [src.id, ext, BASE[s.baseStatus] || 'unavailable'])
        st.statuses++
      }
      for (const [k, v] of Object.entries(BASE)) await q(`insert into status_map (source_id, external_status, status) values ($1,$2,$3) on conflict (source_id, external_status) do nothing`, [src.id, k, v])
    }
    const smap = new Map((await q(`select external_status, status from status_map where source_id = $1`, [src.id])).map((r) => [r.external_status, r.status]))
    const toStatus = (p) => smap.get(String(p.customStatusId)) || smap.get(p.status) || 'unavailable'

    for (const [pbProject, slug] of Object.entries(cfg.projects || {})) {
      const proj = (await q(`select id from projects where slug = $1`, [slug]))[0]
      if (!proj) { st.errors.push(`нет проекта ${slug}`); continue }
      const houses = (await pb.get('/house', { projectId: pbProject })).data || []
      const blds = await q(`select id, external_id, name from buildings where project_id = $1`, [proj.id])
      const bmap = new Map()
      for (const h of houses) {
        const ext = (cfg.houses || {})[String(h.id)]
        const b = blds.find((x) => (ext && x.external_id === ext) || x.name === h.title)
        if (b) bmap.set(h.id, b); else st.errors.push(`дом ${h.id} «${h.title}» не сопоставлен`)
      }
      // Квартиры: full=true — до 100 за запрос
      const props = []
      for (let off = 0; ; off += 100) {
        const r = await pb.get('/property', { projectId: pbProject, full: 'true', limit: 100, offset: off, isArchive: 'false' })
        const d = r.data || []; props.push(...d); if (d.length < 100) break
      }
      const units = await q(`select id, building_id, number, external_id, status, price_list::float price, price_currency, area_total_m2::float area, floor, locked_fields, raw from units where project_id = $1`, [proj.id])
      const byExt = new Map(units.filter((u) => u.external_id).map((u) => [u.external_id, u]))
      // id квартир в текущей выгрузке: наша квартира со «старым» id, которого в выгрузке нет, — кандидат на пересопоставление по номеру
      const feedIds = new Set(props.map((p) => String(p.id)))
      const seen = new Set()
      const cur = cfg.currency || 'USD'
      await tx(async (db) => {
        // Правки синхронизации помечаются источником: журнал квартиры пишет «sync:<id>», замки ручных правок не ставятся
        await db.query(`select set_config('app.sync_source', $1, true), set_config('app.skip_refresh', 'on', true)`, [src.id])
        for (const p of props) {
          st.checked++
          const b = bmap.get(p.house_id); if (!b) continue
          // Сопоставление: по id Profitbase; в первый раз — по корпусу и номеру (с префиксом корпуса и без)
          let u = byExt.get(String(p.id))
          if (!u) {
            const n = String(p.number).toUpperCase()
            // По номеру — квартиры без id или с id, которого больше нет в Profitbase (застройщик пересоздал квартиру)
            u = units.find((x) => x.building_id === b.id && (!x.external_id || !feedIds.has(x.external_id)) && !seen.has(x.external_id || '') && [x.number.toUpperCase(), x.number.toUpperCase().replace(/^[A-ZА-Я]{1,3}-/, '')].includes(n))
            if (u) {
              if (u.external_id) st.rematched = (st.rematched || 0) + 1
              await db.query(`update units set external_id = $2, source_id = $3, raw = coalesce(raw, '{}'::jsonb) #- '{pb,gone_at}' where id = $1`, [u.id, String(p.id), src.id])
              byExt.delete(u.external_id); u.external_id = String(p.id); if (u.raw?.pb) delete u.raw.pb.gone_at
            }
          }
          const want = { status: toStatus(p), price_list: p.price?.value ? Number(p.price.value) : null, area_total_m2: p.area?.area_total ? Number(p.area.area_total) : null, floor: Number(p.floor) }
          const raw = { pb: { id: p.id, status: p.status, customStatusId: p.customStatusId, window_view: p.attributes?.window_view || null, code: p.attributes?.code || null, rooms: ROOMS(p), specialOffersIds: p.specialOffersIds || [], bookedUntil: p.bookedUntilDate || null, synced: new Date().toISOString() } }
          if (!u) {
            // Новая квартира в Profitbase — заводим в нашем корпусе
            await db.query(`insert into units (project_id, building_id, number, floor, unit_type, area_total_m2, price_list, price_currency, status, source_id, external_id, raw, external_status)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [proj.id, b.id, String(p.number), want.floor, TYPE(p), want.area_total_m2, want.price_list, cur, want.status, src.id, String(p.id), raw, p.status])
            st.created++; seen.add(String(p.id)); continue
          }
          seen.add(String(p.id))
          // Наши ручные правки (locked_fields) синхронизация не перетирает
          let locked = u.locked_fields || []
          const set = {}
          // «Продано» у застройщика сильнее ручного замка статуса: квартиру больше не продать, замок снимаем
          if (want.status === 'sold' && locked.includes('status')) { locked = locked.filter((x) => x !== 'status'); set.locked_fields = JSON.stringify(locked); st.unlocked_sold = (st.unlocked_sold || 0) + 1 }
          if (!locked.includes('status') && want.status !== u.status) set.status = want.status
          if (!locked.includes('price_list') && want.price_list !== u.price) set.price_list = want.price_list
          if (want.area_total_m2 && Math.abs(want.area_total_m2 - (u.area || 0)) > 0.005) set.area_total_m2 = want.area_total_m2
          if (want.floor && want.floor !== u.floor) set.floor = want.floor
          const keys = Object.keys(set)
          await db.query(`update units set ${keys.map((k, i) => `${k} = $${i + 2}, `).join('')}raw = coalesce(raw, '{}'::jsonb) || $${keys.length + 2}::jsonb, external_status = $${keys.length + 3}, synced_at = now() where id = $1`,
            [u.id, ...keys.map((k) => set[k]), raw, p.status])
          if (keys.length) st.changed++
        }
        // Исчезнувшие из Profitbase — не удаляем: «не в продаже» с пометкой (на них ссылаются брони и подборки)
        for (const u of units.filter((x) => x.external_id && !seen.has(x.external_id) && !(x.raw?.pb?.gone_at))) {
          await db.query(`update units set status = 'unavailable', raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('pb', coalesce(raw->'pb', '{}'::jsonb) || jsonb_build_object('gone_at', now())) where id = $1`, [u.id])
          st.gone++
          const bk = await db.query(`select b.agent_id, portal.unit_no(bl.external_id, un.number) no from portal.bookings b join units un on un.id = b.unit_id join buildings bl on bl.id = un.building_id where b.unit_id = $1 and b.status in ('requested','confirmed')`, [u.id])
          for (const r of bk.rows) if (notify) await notify(r.agent_id, 'booking', 'Квартира {u} исчезла из каталога застройщика — проверьте бронь', '/bookings', { u: r.no }, 'pb-gone:' + u.id)
        }
        await db.query(`select set_config('app.skip_refresh', '', true)`)
        await db.query('select refresh_catalog()')
      })
      st.unmatched.push(...props.filter((p) => !bmap.has(p.house_id)).slice(0, 20).map((p) => `${p.house_id}/${p.number}`))
      // План этажа из /floor: картинка Profitbase + контуры по propertyId (раз в сутки)
      if (daily) for (const [hid, b] of bmap) {
        const floors = await pb.get('/floor', { houseId: hid })
        const list = Array.isArray(floors) ? floors : floors.data || []
        const ids = new Map((await q(`select external_id, number, floor from units where building_id = $1 and external_id is not null`, [b.id])).map((r) => [r.external_id, r]))
        for (const f of list) {
          const W = Number(f.originalLayoutWidth) || 1, H = Number(f.originalLayoutHeight) || 1
          const cells = (f.areas || []).map((a) => { const u = ids.get(String(a.propertyId)); return u && a.coordinates?.length >= 3 ? { riser: riserOf(u.number), points: a.coordinates.map((c) => [+(c.x / W).toFixed(4), +(c.y / H).toFixed(4)]) } : null }).filter(Boolean)
          const floorNo = Number(f.number) || (ids.get(String(f.areas?.[0]?.propertyId))?.floor ?? null)
          if (floorNo == null || !f.images?.large) continue
          const ex = (await q(`select id from portal.floor_plans where building_id = $1 and source = $2 and pb_floor_id = $3`, [b.id, src.id, f.id]))[0]
          // Картинку храним ссылкой на Profitbase в files (mime image/url): портал отдаёт редирект; без скачивания на каждом прогоне
          const fid = ex ? null : (await q(`insert into portal.files (filename, mime, size, disk_name) values ($1, 'image/url', 0, $2) returning id`, [`Profitbase floor ${f.id}`, f.images.large]))[0].id
          if (ex) await q(`update portal.floor_plans set cells = $2, floor_from = $3, floor_to = $3, north_deg = $4 where id = $1`, [ex.id, JSON.stringify(cells), floorNo, Number(f.lightSideAngle) || 0])
          else await q(`insert into portal.floor_plans (building_id, file_id, title, floor_from, floor_to, north_deg, cells, source, pb_floor_id) values ($1,$2,$3,$4,$4,$5,$6,$7,$8)`, [b.id, fid, `Profitbase · этаж ${floorNo}`, floorNo, Number(f.lightSideAngle) || 0, JSON.stringify(cells), src.id, f.id])
          st.floors++
        }
      }
    }
    const status = st.errors.length ? 'partial' : 'ok'
    await q(`update sync_runs set finished_at = now(), status = $2, stats = $3 where id = $1`, [run, status, JSON.stringify(st)])
    await q(`update sources set last_sync_at = now(), last_sync_status = $2 where id = $1`, [src.id, status])
    return { ok: true, ...st }
  } catch (e) {
    await q(`update sync_runs set finished_at = now(), status = 'failed', stats = $2, error = $3 where id = $1`, [run, JSON.stringify(st), String(e.message || e).slice(0, 500)])
    await q(`update sources set last_sync_status = 'failed' where id = $1`, [src.id])
    return { ok: false, error: String(e.message || e), ...st }
  }
}

function riserOf(n) { const s = String(n).replace(/^[A-Z]-/, ''); const m = s.match(/^(\d+)(.*)$/); return m && m[1].length >= 3 ? m[1].slice(-2) + m[2] : s }

// Запись в Profitbase (М3): бронь, снятие, продажа — из очереди portal.pb_outbox; ошибка — задача офису
export async function pbFlush(q, sources, { task } = {}) {
  let sent = 0
  for (const src of sources) {
    const jobs = await q(`select o.id, o.op, o.status_alias, o.booking_id, o.attempts, u.external_id, portal.unit_no(b.external_id, u.number) no from portal.pb_outbox o join units u on u.id = o.unit_id join buildings b on b.id = u.building_id
      where o.source_id = $1 and o.state in ('pending','error') and o.attempts < 6 order by o.created_at limit 30`, [src.id])
    if (!jobs.length) continue
    const pb = pbClient(src, q)
    for (const j of jobs) {
      if (!j.external_id) { await q(`update portal.pb_outbox set state = 'skipped', last_error = 'квартира не связана с Profitbase' where id = $1`, [j.id]); continue }
      try {
        const r = await pb.post(`/properties/${j.external_id}/status-change`, { status: j.status_alias })
        await q(`update portal.pb_outbox set state = 'sent', sent_at = now(), attempts = attempts + 1, result = $2, last_error = null where id = $1`, [j.id, JSON.stringify(r)]); sent++
      } catch (e) {
        const msg = String(e.message || e).slice(0, 300)
        await q(`update portal.pb_outbox set state = 'error', attempts = attempts + 1, last_error = $2 where id = $1`, [j.id, msg])
        // Третья неудача подряд — задача офису: сделать в Profitbase руками
        if (j.attempts + 1 === 3 && task) for (const o of await q(`select id from portal.users where role = 'office' and active`)) await task(null, o.id, 'Profitbase не принял «{op}» по квартире {u} — сделайте вручную', { op: j.op, u: j.no }, 'pb-out:' + j.id + ':' + o.id)
      }
    }
  }
  return sent
}
