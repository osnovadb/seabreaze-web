import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q, one } from '@/lib/db'
import { t, usd, pct, num } from '@/lib/i18n'
import { planUrl, toUsdSql } from '@/lib/catalog'
import { PLAN_COLS, schedule, planBase, isFull, type Plan } from '@/lib/plans'
import { Top, Pill, SALES } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { saveGenplan, saveFacade, saveFloorPlan, saveRisers } from '@/lib/markup'
import { riser as riserOf } from '@/lib/catalog'
import { saveProject, saveBuilding, saveLayout, saveUnit, generateUnits, bulkUnits, savePlan, saveAccess, saveException } from '@/lib/objects'

const TYPES = ['studio', '1br', '2br', '3br', '4br', 'duplex', 'penthouse', 'townhouse', 'villa', 'commercial', 'parking']
const ST: Record<string, string> = { available: 'свободна', reserved: 'бронь застройщика', sold: 'продана', unavailable: 'не в продаже' }

// Карточка проекта в админке: всё, что влияет на деньги, наличие и доступ (ТЗ, «Портал и CMS»)
export default async function ObjectCard({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string; b?: string; fl?: string } }) {
  const c = await requireCtx()
  if (!['owner', 'office'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const owner = c.user.role === 'owner'
  const p = await one<{ id: string; slug: string; name: string; developer_id: string; city: string | null; location: string | null; delivery: string | null; status: string; sort: number }>('select id, slug, name, developer_id, city, location, delivery, status, sort from projects where id = $1', [params.id])
  if (!p) notFound()
  const ps = await one<{ sales_status: string; agent_markets: string[]; site_urls: Record<string, string> }>('select sales_status, agent_markets, site_urls from portal.project_settings where project_id = $1', [p.id])
  const tab = owner ? searchParams.tab || 'main' : 'units'
  const tabs: [string, string][] = owner ? [['main', 'Основное'], ['blocks', 'Блоки'], ['layouts', 'Планировки'], ['units', 'Квартиры'], ['plans', 'Планы оплаты'], ['markup', 'Разметка'], ['orient', 'Ориентация'], ['terms', 'Условия'], ['access', 'Видимость']] : [['units', 'Квартиры']]
  const blocks = await q<{ id: string; name: string; external_id: string | null; kind: string; floors_total: number | null; delivery: string | null; sort: number; n: number }>(
    'select b.id, b.name, b.external_id, b.kind, b.floors_total, b.delivery, b.sort, (select count(*)::int from units u where u.building_id = b.id) n from buildings b where b.project_id = $1 order by b.sort, b.name', [p.id])
  const layouts = await q<{ id: string; code: string; unit_type: string; name: string | null; bedrooms: number | null; internal_area_m2: number | null; external_area_m2: number | null; total_area_m2: number | null; plan_file: string | null; n: number }>(
    'select l.id, l.code, l.unit_type, l.name, l.bedrooms, l.internal_area_m2::float, l.external_area_m2::float, l.total_area_m2::float, l.plan_file, (select count(*)::int from units u where u.layout_id = l.id) n from layouts l where l.project_id = $1 order by l.code', [p.id])
  const sales = SALES[ps?.sales_status || 'draft']
  const tabLink = (k: string) => `?tab=${k}`
  return (
    <>
      <Top crumbs={[[T('Объекты'), '/admin/objects'], [p.name]]} title={p.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}><Pill kind={sales[1]}>{T(sales[0])}</Pill><span className="small muted">{T('Партнёрам')}: {ps?.agent_markets.join(', ') || '—'}</span></span>}
        right={<Link className="btn" href={`/projects/${p.slug}`}>{T('Как видят в портале')} ↗</Link>} />
      <div className="page">
        <div className="tabs">{tabs.map(([k, l]) => <Link key={k} href={k === 'terms' ? `/admin/conditions?p=${p.slug}` : tabLink(k)} className={tab === k ? 'on' : ''}>{T(l)}</Link>)}</div>

        {tab === 'main' && <Main />}
        {tab === 'blocks' && <Blocks />}
        {tab === 'layouts' && <Layouts />}
        {tab === 'units' && <Units />}
        {tab === 'plans' && <Plans />}
        {tab === 'access' && <Access />}
        {tab === 'markup' && <Markup />}
        {tab === 'orient' && <Orient />}
      </div>
    </>
  )

  async function Main() {
    const devs = await q<{ id: string; name: string }>('select id, name from developers order by name')
    return (
      <ActionForm action={saveProject} lang={L} className="card stack" style={{ gap: 10, maxWidth: 640 }}>
        <input type="hidden" name="id" value={p!.id} />
        <label className="field"><span>{T('Название')}</span><input className="in" name="name" defaultValue={p!.name} required /></label>
        <label className="field"><span>{T('Застройщик')}</span><select className="in" name="developer" defaultValue={p!.developer_id}>{devs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}<option value="new">+ {T('новый застройщик')}</option></select></label>
        <label className="field"><span>{T('Новый застройщик (если выбран «новый»)')}</span><input className="in" name="developer_name" /></label>
        <div className="grid g3">
          <label className="field"><span>{T('Город')}</span><input className="in" name="city" defaultValue={p!.city || ''} /></label>
          <label className="field"><span>{T('Сдача')}</span><input className="in" name="delivery" defaultValue={p!.delivery || ''} /></label>
          <label className="field"><span>{T('Стройка')}</span><select className="in" name="status" defaultValue={p!.status}><option value="planned">{T('проект')}</option><option value="under_construction">{T('строится')}</option><option value="completed">{T('сдан')}</option></select></label>
        </div>
        <div className="grid g2">
          <label className="field"><span>{T('Расположение')}</span><input className="in" name="location" defaultValue={p!.location || ''} /></label>
          <label className="field"><span>{T('Порядок в списках')}</span><input className="in" name="sort" type="number" defaultValue={p!.sort} /></label>
        </div>
        <div><button className="btn btn--p">{T('Сохранить')}</button></div>
        <div className="tiny muted">{T('Тексты, фото и дизайн страницы проекта на сайте — в CMS. Здесь — то, что влияет на деньги, наличие и доступ.')}</div>
      </ActionForm>
    )
  }

  function Blocks() {
    const row = (b?: (typeof blocks)[number]) => (
      <ActionForm key={b?.id || 'new'} action={saveBuilding} lang={L} reset={!b} className="objrow" style={{ gridTemplateColumns: '1.4fr .6fr .8fr .6fr 1fr .5fr auto auto' }}>
        <input type="hidden" name="project" value={p!.id} />{b && <input type="hidden" name="id" value={b.id} />}
        <input className="in" name="name" defaultValue={b?.name} placeholder={T('Название блока')} required />
        <input className="in" name="code" defaultValue={b?.external_id || ''} placeholder={T('Код (A, B…)')} />
        <select className="in" name="kind" defaultValue={b?.kind || 'block'}><option value="block">{T('блок')}</option><option value="tower">{T('башня')}</option><option value="villa_cluster">{T('виллы')}</option></select>
        <input className="in" name="floors" type="number" defaultValue={b?.floors_total ?? ''} placeholder={T('этажей')} />
        <input className="in" name="delivery" defaultValue={b?.delivery || ''} placeholder={T('сдача блока')} />
        <input className="in" name="sort" type="number" defaultValue={b?.sort ?? 0} title={T('Порядок')} />
        <button className="btn btn--sm">{b ? T('Сохранить') : T('Добавить')}</button>
        {b ? <button className="btn btn--sm" name="delete" value="1" title={b.n ? T('В блоке {n} квартир', { n: b.n }) : T('Удалить')}>×</button> : <span />}
      </ActionForm>
    )
    return (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="objhead" style={{ gridTemplateColumns: '1.4fr .6fr .8fr .6fr 1fr .5fr auto auto' }}>{['Название', 'Код', 'Тип', 'Этажей', 'Сдача', 'Порядок', '', ''].map((h, i) => <span key={i}>{h ? T(h) : ''}</span>)}</div>
        {blocks.map((b) => row(b))}
        <div className="label mt8">{T('Новый блок')}</div>
        {row()}
        <div className="tiny muted">{T('Код блока — буква в номере квартиры (D-806) и на генплане. Срок сдачи по блоку виден партнёрам в шахматке.')}</div>
      </div>
    )
  }

  function Layouts() {
    const row = (l?: (typeof layouts)[number]) => (
      <ActionForm key={l?.id || 'new'} action={saveLayout} lang={L} reset={!l} className="objrow" style={{ gridTemplateColumns: '64px .8fr .8fr 1fr .5fr .6fr .6fr .6fr 1.2fr auto' }}>
        <input type="hidden" name="project" value={p!.id} />{l && <input type="hidden" name="id" value={l.id} />}
        {l?.plan_file ? <a href={planUrl(l.plan_file)!} target="_blank"><img src={planUrl(l.plan_file)!} alt="" style={{ width: 56, height: 40, objectFit: 'contain', background: '#fff', border: '1px solid var(--line)', borderRadius: 4 }} /></a> : <span className="tiny muted">{T('нет плана')}</span>}
        <input className="in" name="code" defaultValue={l?.code} placeholder={T('Код')} required />
        <select className="in" name="unit_type" defaultValue={l?.unit_type || '2br'}>{TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <input className="in" name="name" defaultValue={l?.name || ''} placeholder={T('Название')} />
        <input className="in" name="bedrooms" type="number" defaultValue={l?.bedrooms ?? ''} placeholder={T('спален')} />
        <input className="in" name="total" defaultValue={l?.total_area_m2 ?? ''} placeholder={T('общая, м²')} />
        <input className="in" name="internal" defaultValue={l?.internal_area_m2 ?? ''} placeholder={T('внутр., м²')} />
        <input className="in" name="external" defaultValue={l?.external_area_m2 ?? ''} placeholder={T('терраса, м²')} />
        <input className="in" name="plan" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" style={{ fontSize: 11 }} />
        <button className="btn btn--sm">{l ? T('Сохранить') : T('Добавить')}</button>
      </ActionForm>
    )
    return (
      <div className="card stack" style={{ gap: 8 }}>
        <div className="objhead" style={{ gridTemplateColumns: '64px .8fr .8fr 1fr .5fr .6fr .6fr .6fr 1.2fr auto' }}>{['План', 'Код', 'Тип', 'Название', 'Спален', 'Общая', 'Внутр.', 'Терраса', 'Файл плана', ''].map((h, i) => <span key={i}>{T(h)}</span>)}</div>
        {layouts.map((l) => row(l))}
        <div className="label mt8">{T('Новая планировка')}</div>
        {row()}
        <div className="tiny muted">{T('Квартиры с этой планировкой берут из неё тип, площади и план. Файл плана — PNG, JPG, WEBP или PDF до 5 МБ.')}</div>
      </div>
    )
  }

  async function Units() {
    const b = blocks.find((x) => x.id === searchParams.b) || blocks[0]
    if (!b) return <div className="card muted">{T('Сначала добавьте блок.')}</div>
    const floors = (await q<{ floor: number }>('select distinct floor from units where building_id = $1 and floor is not null order by floor desc', [b.id])).map((r) => r.floor)
    const fl = searchParams.fl ? Number(searchParams.fl) : null
    const units = await q<{ id: string; number: string; floor: number | null; layout_id: string | null; unit_type: string; area_total_m2: number | null; area_external_m2: number | null; plot_area_m2: number | null; price_list: number | null; price_currency: string; status: string; published: boolean; locked: string[]; hidden: boolean; usd: number | null; source: string }>(
      `select u.id, u.number, u.floor, u.layout_id, u.unit_type, u.area_total_m2::float, u.area_external_m2::float, u.plot_area_m2::float, u.price_list::float, u.price_currency, u.status, u.published,
         (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(u.locked_fields) x) locked, exists (select 1 from portal.unit_hidden h where h.unit_id = u.id) hidden, (${toUsdSql})::float usd, u.source_id source
       from units u where u.building_id = $1 ${fl != null ? 'and u.floor = $2' : ''} order by u.floor desc, u.number`, fl != null ? [b.id, fl] : [b.id])
    const cols = owner ? '.7fr .45fr 1fr .6fr .6fr .8fr .5fr .9fr .5fr .5fr auto' : '.7fr .45fr .8fr .5fr .9fr auto'
    const qs = (o: Record<string, string>) => '?' + new URLSearchParams({ tab: 'units', b: b.id, ...(fl != null ? { fl: String(fl) } : {}), ...o }).toString()
    return (
      <div className="stack">
        <div className="chips">{blocks.map((x) => <Link key={x.id} href={`?tab=units&b=${x.id}`} className={'chip' + (x.id === b.id ? ' on' : '')}>{x.name} <span className="n">{x.n}</span></Link>)}</div>
        <div className="chips"><Link href={qs({ fl: '' }).replace('&fl=', '')} className={'chip' + (fl == null ? ' on' : '')}>{T('Все этажи')}</Link>{floors.map((x) => <Link key={x} href={`?tab=units&b=${b.id}&fl=${x}`} className={'chip' + (fl === x ? ' on' : '')}>{x}</Link>)}</div>
        <div className="card stack" style={{ gap: 6 }}>
          <div className="objhead" style={{ gridTemplateColumns: cols }}>{(owner ? ['Номер', 'Этаж', 'Планировка', 'Площадь', 'Сад/терр.', 'Цена', 'Валюта', 'Статус', 'Сайт', 'Скрыть', ''] : ['Номер', 'Этаж', 'Цена', 'Валюта', 'Статус', '']).map((h, i) => <span key={i}>{h ? T(h) : ''}</span>)}</div>
          {units.length === 0 && <div className="small muted">{T('Квартир пока нет — создайте их ниже.')}</div>}
          {units.map((u) => (
            <ActionForm key={u.id} action={saveUnit} lang={L} className="objrow" style={{ gridTemplateColumns: cols }}>
              <input type="hidden" name="project" value={p!.id} /><input type="hidden" name="id" value={u.id} /><input type="hidden" name="building" value={b.id} />
              {owner ? <input className="in" name="number" defaultValue={u.number} /> : <b className="small">{b.external_id ? b.external_id + '-' : ''}{u.number}</b>}
              {owner ? <input className="in" name="floor" type="number" defaultValue={u.floor ?? ''} /> : <span className="small">{u.floor}</span>}
              {owner && <select className="in" name="layout" defaultValue={u.layout_id || ''}><option value="">—</option>{layouts.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select>}
              {owner && <input className="in" name="area" defaultValue={u.area_total_m2 ?? ''} />}
              {owner && <input className="in" name="ext_area" defaultValue={u.area_external_m2 ?? u.plot_area_m2 ?? ''} />}
              <div><input className="in" name="price" defaultValue={u.price_list ?? ''} />{u.locked.includes('price_list') && <div className="tiny warnc" title={T('Ручная правка: синхронизация не перезапишет цену')}>🔒 {T('замок')}</div>}</div>
              <select className="in" name="currency" defaultValue={u.price_currency}>{['USD', 'AZN', 'EUR'].map((x) => <option key={x} value={x}>{x}</option>)}</select>
              <select className="in" name="status" defaultValue={u.status}>{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select>
              {owner && <select className="in" name="published" defaultValue={u.published ? '1' : '0'}><option value="1">{T('да')}</option><option value="0">{T('нет')}</option></select>}
              {owner && <span><input type="hidden" name="hidden_set" value="1" /><select className="in" name="hidden" defaultValue={u.hidden ? '1' : '0'}><option value="0">—</option><option value="1">{T('скрыть')}</option></select></span>}
              <button className="btn btn--sm">{T('Сохранить')}</button>
            </ActionForm>
          ))}
          <div className="tiny muted">{T('«Сайт» — показывать ли квартиру на сайтах рынков. «Скрыть» — убрать от партнёров (квота, придержать), на сайты не влияет. Ручная правка цены у квартир из Profitbase и xlsx ставит замок от синхронизации.')}</div>
        </div>
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <ActionForm action={bulkUnits} lang={L} className="card stack" style={{ gap: 8 }} okText={T('Цены изменены')}>
            <div className="h3" style={{ margin: 0 }}>{T('Изменить цены свободных квартир')}</div>
            <input type="hidden" name="project" value={p!.id} />
            <label className="field"><span>{T('Где')}</span><select className="in" name="building" defaultValue={b.id}><option value="">{T('Весь проект')}</option>{blocks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="field"><span>{T('На сколько, % (минус — снижение)')}</span><input className="in" name="pct" inputMode="decimal" placeholder="3" required /></label>
            <div><button className="btn">{T('Применить')}</button></div>
          </ActionForm>
          {owner && (
            <ActionForm action={generateUnits} lang={L} reset className="card stack" style={{ gap: 8 }} okText={T('Создано квартир')}>
              <div className="h3" style={{ margin: 0 }}>{T('Добавить квартиры')}</div>
              <input type="hidden" name="project" value={p!.id} />
              <label className="field"><span>{T('Блок')}</span><select className="in" name="building" defaultValue={b.id}>{blocks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              <div className="row"><label className="field" style={{ flex: 1 }}><span>{T('Этажи с')}</span><input className="in" name="floor_from" type="number" required /></label><label className="field" style={{ flex: 1 }}><span>{T('по')}</span><input className="in" name="floor_to" type="number" required /></label></div>
              <label className="field"><span>{T('Позиции на этаже (через запятую)')}</span><input className="in" name="positions" placeholder="01, 02, 03, 04" required /></label>
              <div className="row"><label className="field" style={{ flex: 2 }}><span>{T('Планировка')}</span><select className="in" name="layout"><option value="">—</option>{layouts.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>
                <label className="field" style={{ flex: 2 }}><span>{T('Цена')}</span><input className="in" name="price" inputMode="decimal" /></label>
                <label className="field" style={{ flex: 1 }}><span>{T('Валюта')}</span><select className="in" name="currency">{['USD', 'AZN', 'EUR'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label></div>
              <div><button className="btn btn--p">{T('Создать')}</button></div>
              <div className="tiny muted">{T('Номер = этаж + позиция: этаж 8, позиция 06 → 806. Существующие номера пропускаются. Без цены квартира создаётся «не в продаже».')}</div>
            </ActionForm>
          )}
        </div>
      </div>
    )
  }

  async function Plans() {
    const plans = await q<Plan>(`select ${PLAN_COLS} from payment_plans where project_id = $1 order by sort, name`, [p!.id])
    const ex = await one<{ usd: number }>(`select (${toUsdSql})::float usd from units u where u.project_id = $1 and u.status = 'available' and u.price_list is not null order by u.price_list limit 1`, [p!.id])
    const row = (pl?: Plan) => {
      const full = pl ? isFull(pl) : false
      return (
        <ActionForm key={pl?.id || 'new'} action={savePlan} lang={L} reset={!pl} className="card stack" style={{ gap: 8 }}>
          <input type="hidden" name="project" value={p!.id} />{pl && <input type="hidden" name="id" value={pl.id} />}
          <div className="grid g3">
            <label className="field"><span>{T('Название')}</span><input className="in" name="name" defaultValue={pl?.name} placeholder={T('Рассрочка 24 мес.')} required /></label>
            <label className="field"><span>{T('Тип')}</span><select className="in" name="kind" defaultValue={full ? 'full' : 'installment'}><option value="installment">{T('Первый взнос + N месяцев')}</option><option value="full">{T('100% сразу')}</option></select></label>
            <label className="field"><span>{T('Где действует')}</span><select className="in" name="building" defaultValue={pl?.building_id || ''}><option value="">{T('Весь проект')}</option>{blocks.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          </div>
          <div className="grid g4">
            <label className="field"><span>{T('Первый взнос, %')}</span><input className="in" name="down" inputMode="decimal" defaultValue={full ? '' : pl?.down_payment_pct ?? ''} /></label>
            <label className="field"><span>{T('Срок, мес.')}</span><input className="in" name="months" type="number" defaultValue={full ? '' : pl?.months ?? ''} /></label>
            <label className="field"><span>{T('Скидка за 100%, %')}</span><input className="in" name="discount" inputMode="decimal" defaultValue={pl?.full_payment_discount_pct ?? ''} /></label>
            <label className="field"><span>{T('Порядок')}</span><input className="in" name="sort" type="number" defaultValue={pl?.sort ?? 0} /></label>
          </div>
          <div className="grid g3">
            <label className="field"><span>{T('Действует с')}</span><input className="in" name="valid_from" type="date" defaultValue={pl?.valid_from || ''} /></label>
            <label className="field"><span>{T('по')}</span><input className="in" name="valid_to" type="date" defaultValue={pl?.valid_to || ''} /></label>
            <label className="field"><span>{T('Примечание')}</span><input className="in" name="note" defaultValue={pl?.source_note || ''} /></label>
          </div>
          {pl && ex?.usd ? (() => { const base = planBase(pl, ex.usd); const sc = schedule(pl, base); return <div className="small muted">{T('Пример на квартире за {p}', { p: usd(L, ex.usd) })}: {sc.full ? T('к оплате {a}', { a: usd(L, base) }) : T('взнос {d}, затем {m} × {x}', { d: usd(L, sc.down), m: sc.months, x: usd(L, sc.monthly) })}</div> })() : null}
          <div className="row"><button className="btn btn--sm btn--p">{pl ? T('Сохранить') : T('Добавить план')}</button>{pl && <button className="btn btn--sm" name="delete" value="1">{T('Удалить')}</button>}</div>
        </ActionForm>
      )
    }
    return (
      <div className="stack">
        {plans.map((pl) => row(pl))}
        <div className="label">{T('Новый план оплаты')}</div>
        {row()}
        <div className="tiny muted">{T('Скидка за 100% — скидка застройщика: снижает цену до раздела денег, фикс и пул считаются от сниженной цены. Планы видят партнёры в карточке квартиры и при брони, клиент — в режиме показа и на сайтах.')}</div>
      </div>
    )
  }

  async function Access() {
    const sites = (await q<{ market_id: string }>('select market_id from project_markets where project_id = $1 and visible', [p!.id])).map((r) => r.market_id)
    const ex = await q<{ id: string; allow: boolean; who: string; note: string | null }>(`select x.id, x.allow, coalesce(a.name, u.name) who, x.note from portal.project_exceptions x left join portal.agencies a on a.id = x.agency_id left join portal.users u on u.id = x.user_id where x.project_id = $1 order by x.created_at`, [p!.id])
    const who = await q<{ v: string; l: string }>(`select 'agency:' || id v, name || ' · ' || market l from portal.agencies union all select 'user:' || id, name from portal.users where active and role in ('agent','agency_head') order by 2`)
    const hidden = await one<{ n: number }>('select count(*)::int n from portal.unit_hidden h join units u on u.id = h.unit_id where u.project_id = $1', [p!.id])
    const st = ps?.sales_status || 'draft'
    return (
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <ActionForm action={saveAccess} lang={L} className="card stack" style={{ gap: 12 }}>
          <input type="hidden" name="project" value={p!.id} />
          <div className="h3" style={{ margin: 0 }}>{T('Статус продаж')}</div>
          <div className="stack" style={{ gap: 6 }}>{([['draft', 'Черновик — видит только команда'], ['sales', 'В продаже'], ['stop', 'Стоп-продажи — партнёры видят, но не бронируют; брони доживают срок'], ['closed', 'Закрыт — партнёры не видят']] as const).map(([k, l]) => <label key={k} className="check"><input type="radio" name="sales_status" value={k} defaultChecked={st === k} /> <span>{T(l)}</span></label>)}</div>
          <div className="h3" style={{ margin: '8px 0 0' }}>{T('Открыт партнёрам рынков')}</div>
          <div className="row">{['DE', 'IL', 'GLOBAL'].map((m) => <label key={m} className="check"><input type="checkbox" name={'m_' + m} defaultChecked={ps?.agent_markets.includes(m)} /> <span>{m}</span></label>)}</div>
          <div className="h3" style={{ margin: '8px 0 0' }}>{T('Опубликован на сайтах')}</div>
          <div className="row">{[['dach', 'ge-de (DACH)'], ['il', 'ge-il (Израиль)']].map(([m, l]) => <label key={m} className="check"><input type="checkbox" name={'site_' + m} defaultChecked={sites.includes(m)} /> <span>{l}</span></label>)}</div>
          <div className="h3" style={{ margin: '8px 0 0' }}>{T('Ссылка «На сайте» для партнёров рынка')}</div>
          {['DE', 'IL', 'GLOBAL'].map((m) => <label key={m} className="field"><span>{m}</span><input className="in" name={'url_' + m} defaultValue={ps?.site_urls?.[m] || ''} placeholder="https://" /></label>)}
          <div><button className="btn btn--p">{T('Сохранить')}</button></div>
          <div className="tiny muted">{T('Партнёр видит проект, если статус «в продаже» или «стоп-продажи» и открыт его рынок — или есть исключение «открыть». Исключение «закрыть» сильнее рынка. Скрыто квартир от партнёров: {n}.', { n: hidden!.n })}</div>
        </ActionForm>
        <div className="card stack" style={{ gap: 8 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Исключения')}</div>
          {ex.length === 0 && <div className="small muted">—</div>}
          {ex.map((x) => <div key={x.id} className="kv"><span><Pill kind={x.allow ? 'ok' : 'bad'}>{T(x.allow ? 'открыть' : 'закрыть')}</Pill> {x.who}{x.note && <div className="tiny muted">{x.note}</div>}</span>
            <form action={saveException}><input type="hidden" name="project" value={p!.id} /><input type="hidden" name="delete" value={x.id} /><button className="btn btn--sm">×</button></form></div>)}
          <form action={saveException} className="stack mt8" style={{ gap: 6 }}>
            <input type="hidden" name="project" value={p!.id} />
            <select className="in" name="who" required defaultValue=""><option value="" disabled>{T('Агентство или партнёр')}</option>{who.map((w) => <option key={w.v} value={w.v}>{w.l}</option>)}</select>
            <div className="row"><select className="in" name="allow" style={{ flex: 1 }}><option value="1">{T('открыть (эксклюзив, пилот)')}</option><option value="0">{T('закрыть')}</option></select><input className="in" name="note" placeholder={T('комментарий')} style={{ flex: 2 }} /></div>
            <button className="btn btn--sm">{T('Добавить исключение')}</button>
          </form>
        </div>
      </div>
    )
  }
  // Разметка: генплан (контуры домов), фасады (сетка окон), поэтажные планы (контуры квартир по стоякам)
  async function Markup() {
    const gp = await one<{ image: string; polygons: unknown[] }>('select image, polygons from portal.genplans where project_id = $1', [p!.id])
    const facades = await q<{ id: string; building_id: string; title: string; risers: string[]; floor_from: number; floor_to: number; file_id: string }>(`select f.id, f.building_id, f.title, f.risers, f.floor_from, f.floor_to, f.file_id from portal.facades f join buildings b on b.id = f.building_id where b.project_id = $1 order by b.sort, f.sort, f.created_at`, [p!.id])
    const plans = await q<{ id: string; building_id: string; title: string; floor_from: number; floor_to: number; file_id: string; cells: unknown[] }>(`select f.id, f.building_id, f.title, f.floor_from, f.floor_to, f.file_id, f.cells from portal.floor_plans f join buildings b on b.id = f.building_id where b.project_id = $1 order by b.sort, f.floor_from`, [p!.id])
    const bname = (id: string) => blocks.find((b) => b.id === id)?.name || ''
    return (
      <div className="stack">
        <div className="grid g2" style={{ alignItems: 'start' }}>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Генплан')}</div>
            {gp ? <div className="fz"><img src={gp.image} alt="" /></div> : <div className="small muted">{T('Картинки генплана пока нет.')}</div>}
            {gp && <div className="small">{T('Размечено домов: {n} из {t}', { n: (gp.polygons || []).length, t: blocks.length })} · <Link className="bronze" href={`/admin/objects/${p!.id}/genplan`}>{T('Разметить дома')} →</Link></div>}
            <ActionForm action={saveGenplan} lang={L} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="project" value={p!.id} />
              <input className="in" type="file" name="file" accept="image/png,image/jpeg,image/webp" required style={{ flex: 1, paddingTop: 6 }} />
              <button className="btn btn--sm">{gp ? T('Заменить картинку') : T('Загрузить')}</button>
            </ActionForm>
            <div className="tiny muted">{T('Аэрорендер или фото проекта сверху. После загрузки обведите каждый дом — на странице проекта дом станет кликабельным и покажет свободные квартиры и цену от.')}</div>
          </div>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="h3" style={{ margin: 0 }}>{T('Фасады')}</div>
            {facades.length === 0 && <div className="small muted">{T('Фасадов пока нет.')}</div>}
            {facades.map((f) => <div key={f.id} className="kv"><span style={{ color: 'var(--ink)' }}>{bname(f.building_id)} · {f.title}<div className="tiny muted">{T('стояки')} {f.risers.join(', ')} · {T('этажи')} {f.floor_from}–{f.floor_to}</div></span>
              <span className="row" style={{ gap: 6 }}><Link className="btn btn--sm" href={`/admin/objects/${p!.id}/facade/${f.id}`}>{T('Калибровать')}</Link>
                <ActionForm action={saveFacade} lang={L}><input type="hidden" name="project" value={p!.id} /><input type="hidden" name="id" value={f.id} /><button className="btn btn--sm" name="delete" value="1">×</button></ActionForm></span></div>)}
            <ActionForm action={saveFacade} lang={L} className="stack mt8" style={{ gap: 6 }} reset>
              <input type="hidden" name="project" value={p!.id} />
              <div className="row" style={{ gap: 6 }}>
                <select className="in" name="building" style={{ flex: 1 }}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
                <input className="in" name="title" placeholder={T('Сторона: к морю, во двор…')} style={{ flex: 1 }} />
              </div>
              <div className="row" style={{ gap: 6 }}>
                <input className="in" name="risers" placeholder={T('Стояки слева направо: 01, 02, 03')} required style={{ flex: 2 }} />
                <input className="in" name="floor_from" type="number" placeholder={T('с')} defaultValue={2} style={{ flex: 1 }} />
                <input className="in" name="floor_to" type="number" placeholder={T('по')} defaultValue={12} style={{ flex: 1 }} />
              </div>
              <div className="row" style={{ gap: 6 }}><input className="in" type="file" name="file" accept="image/png,image/jpeg,image/webp" required style={{ flex: 1, paddingTop: 6 }} /><button className="btn btn--sm btn--p">{T('Добавить фасад')}</button></div>
            </ActionForm>
          </div>
        </div>
        <div className="card stack" style={{ gap: 8 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Поэтажные планы')}</div>
          {plans.length === 0 && <div className="small muted">{T('Планов этажей пока нет — в портале показывается условная схема этажа.')}</div>}
          {plans.map((f) => <div key={f.id} className="kv"><span style={{ color: 'var(--ink)' }}>{bname(f.building_id)} · {f.title}<div className="tiny muted">{T('этажи')} {f.floor_from}–{f.floor_to} · {T('размечено квартир')}: {(f.cells || []).length}</div></span>
            <span className="row" style={{ gap: 6 }}><Link className="btn btn--sm" href={`/admin/objects/${p!.id}/floor/${f.id}`}>{T('Разметить квартиры')}</Link>
              <ActionForm action={saveFloorPlan} lang={L}><input type="hidden" name="project" value={p!.id} /><input type="hidden" name="id" value={f.id} /><button className="btn btn--sm" name="delete" value="1">×</button></ActionForm></span></div>)}
          <ActionForm action={saveFloorPlan} lang={L} className="row mt8" style={{ gap: 6 }} reset>
            <input type="hidden" name="project" value={p!.id} />
            <select className="in" name="building" style={{ flex: 1 }}>{blocks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            <input className="in" name="title" placeholder={T('Типовой этаж')} style={{ flex: 1 }} />
            <input className="in" name="floor_from" type="number" placeholder={T('с')} defaultValue={2} style={{ width: 70 }} />
            <input className="in" name="floor_to" type="number" placeholder={T('по')} defaultValue={12} style={{ width: 70 }} />
            <input className="in" name="north" type="number" placeholder={T('север, °')} title={T('Куда смотрит север на картинке: 0 — вверх, 90 — вправо')} style={{ width: 90 }} />
            <input className="in" type="file" name="file" accept="image/png,image/jpeg,image/webp" required style={{ flex: 1, paddingTop: 6 }} />
            <button className="btn btn--sm btn--p">{T('Добавить план')}</button>
          </ActionForm>
          <div className="tiny muted">{T('План типового этажа от застройщика. Один план на диапазон этажей; после загрузки обведите квартиры по стоякам — на экране «Этаж» они станут кликабельными и окрасятся по статусу.')}</div>
        </div>
      </div>
    )
  }

  // Ориентация стояков: куда выходят окна и сторона света — для карточки квартиры, фильтра «вид» и сайтов
  async function Orient() {
    const b = blocks.find((x) => x.id === searchParams.b) || blocks[0]
    if (!b) return <div className="card muted">{T('Сначала добавьте блок.')}</div>
    const us = await q<{ number: string; floor: number; area: number | null; unit_type: string; view_side: string | null }>('select number, floor, area_total_m2::float area, unit_type, view_side from units where building_id = $1', [b.id])
    const info = await q<{ riser: string; view_side: string | null; direction: string | null; note: string | null }>('select riser, view_side, direction, note from portal.riser_info where building_id = $1', [b.id])
    const rs = Array.from(new Set(us.map((u) => riserOf(u)))).sort((a, b2) => (parseInt(a) || 0) - (parseInt(b2) || 0) || a.localeCompare(b2))
    const VIEWS: [string, string][] = [['', '—'], ['yard', 'во двор'], ['city', 'на улицу / город'], ['sea', 'на море'], ['marina', 'на марину'], ['park', 'на парк'], ['mixed', 'на две стороны']]
    const DIRS = ['', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    return (
      <div className="stack">
        <div className="chips">{blocks.map((x) => <Link key={x.id} href={`?tab=orient&b=${x.id}`} className={'chip' + (x.id === b.id ? ' on' : '')}>{x.name}</Link>)}</div>
        <ActionForm action={saveRisers} lang={L} className="card stack" style={{ gap: 6 }} okText={T('Сохранено · квартир обновлено')}>
          <input type="hidden" name="project" value={p!.id} /><input type="hidden" name="building" value={b.id} />
          <div className="objhead" style={{ gridTemplateColumns: '.6fr 1.4fr 1.2fr .8fr 1.6fr' }}>{['Стояк', 'Квартиры', 'Вид из окон', 'Сторона', 'Примечание'].map((h) => <span key={h}>{T(h)}</span>)}</div>
          {rs.map((r) => { const xs = us.filter((u) => riserOf(u) === r); const i = info.find((x) => x.riser === r); const areas = xs.map((x) => x.area || 0).filter(Boolean); const own = xs.filter((x) => x.view_side && x.view_side !== (i?.view_side ?? null)).map((x) => x.floor).sort((a, b2) => a - b2); return (
            <div key={r} className="objrow" style={{ gridTemplateColumns: '.6fr 1.4fr 1.2fr .8fr 1.6fr' }}>
              <b>{r}</b>
              <span className="tiny muted">{xs.length} · {xs[0]?.unit_type}{areas.length ? ` · ${Math.min(...areas)}–${Math.max(...areas)} m²` : ''}{own.length ? <><br />{T('свой вид: этажи {f}', { f: own.join(', ') })}</> : null}</span>
              <select className="in" name={'v_' + r} defaultValue={i?.view_side || ''}>{VIEWS.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select>
              <select className="in" name={'d_' + r} defaultValue={i?.direction || ''}>{DIRS.map((k) => <option key={k} value={k}>{k || '—'}</option>)}</select>
              <input className="in" name={'n_' + r} defaultValue={i?.note || ''} placeholder={T('угловая, вид на бассейн…')} />
            </div>
          ) })}
          <div><button className="btn btn--p">{T('Сохранить ориентацию')}</button></div>
          <div className="tiny muted">{T('Ориентация задаётся на стояк — все квартиры стояка смотрят в одну сторону. Вид из окон пишется и в каталог: его видят сайты и фильтр «вид» в портале. Данные берём из поэтажных планов и кабинета Profitbase застройщика.')} {T('Если на каком-то этаже нарезка другая и квартира с тем же номером стоит в другом месте, у неё свой вид — сохранение стояка его не перезапишет.')}</div>
        </ActionForm>
      </div>
    )
  }

}
