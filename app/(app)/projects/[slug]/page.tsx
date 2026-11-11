import Link from 'next/link'
import { genplanOf, viewIndex } from '@/lib/genplan'
import { preload } from 'react-dom'
import { plural } from '@/lib/i18n'
import { deliveryRange, fmtDelivery } from '@/lib/delivery'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one, q } from '@/lib/db'
import { t, usd, pct, date, num, m2u } from '@/lib/i18n'
import { projectBySlug, buildingsOf, conditionsFor, plansFor, roomsSql, toUsdSql, TYPE_NAME } from '@/lib/catalog'
import { isFull, termUnknown, schedule, planBase, planLabel } from '@/lib/plans'
import { isExternal, seesDeveloperTerms } from '@/lib/perm'
import { fmtSize } from '@/lib/files'
import { Top, Pill, SALES } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { saveProjectFile, deleteProjectFile } from '@/lib/content'
import { cleanMarks, markIcon, markText } from '@/lib/surround'

type PF = { id: string; kind: string; title: string; lang: string; audience: string; file_id: string | null; url: string | null; size: number | null; mime: string | null; created_at: string }
const LANG_FLAG: Record<string, string> = { all: 'RU EN DE HE', ru: 'RU', en: 'EN', de: 'DE', he: 'HE' }

// Рабочая страница проекта (ТЗ, «Портал и CMS»): генплан и шахматка, условия, материалы для клиента, документы и ссылка на страницу проекта на сайте рынка.
// Полный контент и дизайн проекта — в CMS и на сайте.
export default async function ProjectPage(
  props: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string; l?: string; v?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const ext = isExternal(c.user.role)
  const cond = await conditionsFor(p.id, ext ? c.user : null)
  // 366: лимиты броней — у застройщика на все его проекты
  const dvl = await one<{ lim: number; person: number }>(`select d.max_bookings_total lim, d.max_bookings_person person from public.projects px join portal.developers d on d.catalog_id = px.developer_id where px.id = $1`, [p.id])
  const plans = await plansFor(p.id, null)
  const ps = await one<{ site_urls: Record<string, string> }>('select site_urls from portal.project_settings where project_id = $1', [p.id])
  const site = ps?.site_urls?.[c.user.market || ''] || ps?.site_urls?.GLOBAL || Object.values(ps?.site_urls || {})[0]
  const files = await q<PF>(`select pf.id, pf.kind, pf.title, pf.lang, pf.audience, pf.file_id, pf.url, f.size::int, f.mime, pf.created_at from portal.project_files pf left join portal.files f on f.id = pf.file_id
    where pf.project_id = $1 ${ext ? "and pf.audience <> 'team'" : ''} order by pf.kind, pf.sort, pf.created_at`, [p.id])
  const canEdit = ['owner', 'content'].includes(c.user.role)
  const tab = ['terms', 'materials', 'docs'].includes(searchParams.tab || '') ? searchParams.tab! : 'plan'
  const mats = files.filter((f) => f.kind !== 'document'), docs = files.filter((f) => f.kind === 'document')
  const sales = SALES[p.sales_status] || SALES.draft
  // Свободные по типам и комнатам: сколько, площадь и цена от — сводка для партнёра без открытия шахматки
  const mix = await q<{ k: string; n: number; amin: number; amax: number; pmin: number | null }>(`select case when ${roomsSql} is null then u.unit_type else least(${roomsSql}, 4)::text end k, count(*)::int n,
      min(u.area_total_m2)::float amin, max(u.area_total_m2)::float amax, min(${toUsdSql})::float pmin from units u where u.project_id = $1 and u.status = 'available' and u.price_list is not null
      and not exists (select 1 from portal.bookings x where x.unit_id = u.id and x.status in ('hold','queued','requested','confirmed','release_pending')) and not exists (select 1 from portal.deals d where d.unit_id = u.id and d.stage <> 'cancelled')
      ${ext ? 'and not exists (select 1 from portal.unit_hidden h where h.unit_id = u.id)' : ''} group by 1 order by 1`, [p.id])
  const finishes = (await q<{ finish: string }>('select distinct finish from units where project_id = $1 and finish is not null', [p.id])).map((r) => r.finish)
  const FIN: Record<string, string> = { shell: 'без ремонта', white_box: 'white box', turnkey: 'с ремонтом', furnished: 'с мебелью' }
  // срок проекта: свой или диапазон по блокам; формат — по языку (квартал + год)
  const deliveryLabel = deliveryRange(L, p.delivery, bs.map((b) => b.delivery))
  const tabs: [string, string, string][] = [['plan', 'Генплан', `/projects/${p.slug}`], ['chess', 'Шахматка', `/projects/${p.slug}/chess`], ['list', 'Список', `/catalog?p=${p.slug}`],
    ['terms', 'Условия', `?tab=terms`], ['materials', `${T('Материалы')} · ${mats.length}`, `?tab=materials`], ['docs', `${T('Документы')} · ${docs.length}`, `?tab=docs`]]
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name]]} title={p.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}>{p.sales_status !== 'sales' && <Pill kind={sales[1]}>{T(sales[0])}</Pill>}<span className="small muted">{p.developer} · {p.city || 'Баку'}{p.location ? ' · ' + p.location : ''}</span></span>}
        right={<>{site && <a className="btn" href={site} target="_blank" rel="noopener">{T('На сайте')} ↗</a>}<Link className="btn btn--p" href={`/projects/${p.slug}/chess`}>{T('Шахматка')}</Link></>} />
      <div className="page">
        <div className="grid g4" style={{ marginBottom: 16 }}>
          {[[String(p.free), T('свободно из {n}', { n: p.units })], [p.min_usd ? usd(L, p.min_usd) : '—', T('цена от, по прайсу застройщика')], [deliveryLabel || T('уточняется'), T('срок сдачи')], [String(p.buildings), plural(L, p.buildings, 'корпусов')]].map(([a, b]) => (
            <div key={b} className="card card--tight kpi"><div className="v" style={{ fontSize: 22 }}>{a}</div><div className="small muted">{b}</div></div>
          ))}
        </div>
        <div className="tabs" style={{ margin: 0 }}>{tabs.map(([k, l, href]) => <Link key={k} className={tab === k ? 'on' : ''} href={href}>{k === 'materials' || k === 'docs' ? l : T(l)}</Link>)}</div>
        <div className="mt16">
          {tab === 'plan' && <PlanTab />}
          {tab === 'terms' && <Terms />}
          {tab === 'materials' && <Files list={mats} kind="material" />}
          {tab === 'docs' && <Files list={docs} kind="document" />}
        </div>
      </div>
    </>
  )

  async function PlanTab() {
    const g0 = await genplanOf(p!.id)
    // Денис 11.11: ракурсы генплана — переключатель над картинкой; окружение (метки) — только на основном виде
    const vi = g0 ? viewIndex(searchParams.v, g0.views.length) : 0
    const gp = g0 ? { ...g0.views[vi], note: g0.note, marks: vi === 0 ? g0.marks : [] } : null
    g0?.views.forEach((v, i) => { if (i !== vi) preload(v.image, { as: 'image' }) }) // О89: картинки других ракурсов — заранее, чтобы контуры не ложились на старую
    const byExt = Object.fromEntries(bs.map((b) => [b.external_id || b.name, b]))
    return (
      <div className="split">
        <div>
          {gp && cleanMarks(gp.marks).length > 0 && <><input type="checkbox" id="sur" className="sur-t" defaultChecked /><label htmlFor="sur" className="chip sur-l">{T('Окружение')}</label></>}
          {g0 && g0.views.length > 1 && <div className="chips" style={{ marginBottom: 8 }}>{g0.views.map((v, i) => <Link key={i} href={`?v=${i}`} scroll={false} className={'chip' + (i === vi ? ' on' : '')}>{i === 0 ? '' : '↻ '}{T(v.title || 'Ракурс {n}', { n: i + 1 })}</Link>)}</div>}
          {gp ? (
            <div className="gp">
              {cleanMarks(gp.marks).map((m, i) => <span key={i} className="smark" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%` }}><i>{markIcon(m.kind)}</i><b>{markText(L, m)}</b></span>)}
              <img src={gp.image} alt="" />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                {gp.polygons.map((g) => byExt[g.block] && <a key={g.block} href={`/projects/${p!.slug}/chess?b=${byExt[g.block].id}`}><polygon points={g.points.map((x) => x.join(',')).join(' ')} /></a>)}
              </svg>
              {gp.polygons.map((g) => byExt[g.block] && (
                <div key={g.block} className="tag" style={{ left: `${g.label[0] * 100}%`, top: `${g.label[1] * 100}%` }}>
                  <b>{byExt[g.block].name}</b><span className="tag__s">{T('{n} свободно', { n: byExt[g.block].free })}{byExt[g.block].min_usd ? ' · ' + T('от {p}', { p: usd(L, byExt[g.block].min_usd!) }) : ''}</span>
                </div>
              ))}
            </div>
          ) : <div className="card small muted">{T('Генплан с контурами домов появится после загрузки — пока выберите блок ниже.')}</div>}
          {gp?.note && !ext && <div className="small bronze mt8">{T(gp.note)}</div>}
          <div className="grid g4 mt16">
            {bs.map((b) => <Link key={b.id} href={`/projects/${p!.slug}/chess?b=${b.id}`} className="card card--tight"><b>{b.name}</b><div className="small muted">{T('{n} свободно', { n: b.free })} / {b.units}{b.min_usd ? ' · ' + T('от {p}', { p: usd(L, b.min_usd) }) : ''}</div>{b.delivery && <div className="tiny muted">{T('сдача')}: {fmtDelivery(L, b.delivery)}</div>}</Link>)}
          </div>
        </div>
        <div className="stack">
          {mix.length > 0 && <div className="card">
            <div className="between"><div className="h3" style={{ margin: 0 }}>{T('Свободно сейчас')}</div><Link className="small bronze" href={`/catalog?p=${p!.slug}`}>{T('В каталог')} →</Link></div>
            <table className="tbl mt8" style={{ fontSize: 13 }}><tbody>{mix.map((m) => (
              <tr key={m.k}><td><Link href={`/catalog?p=${p!.slug}${/^\d$/.test(m.k) ? '&r=' + m.k : '&t=' + m.k}`}><b>{/^\d$/.test(m.k) ? (m.k === '4' ? '4+' : m.k) + ' ' + T('комн.') : T(TYPE_NAME[m.k] || m.k)}</b></Link></td>
                <td className="num">{m.n}</td><td className="small muted">{m.amin === m.amax ? num(L, m.amin, 2) : `${num(L, m.amin, 2)}–${num(L, m.amax, 2)}`} {m2u(L)}</td><td className="num small">{m.pmin ? T('от {p}', { p: usd(L, m.pmin) }) : '—'}</td></tr>))}</tbody></table>
          </div>}
          <TermsCard short />
          <div className="card">
            <div className="between"><div className="h3" style={{ margin: 0 }}>{T('Материалы для клиента')}</div><Link className="small bronze" href="?tab=materials">{T('Все')} →</Link></div>
            {mats.length === 0 && <div className="small muted mt8">{T('Материалы пока не загружены.')}</div>}
            {mats.slice(0, 5).map((f) => <FileRow key={f.id} f={f} compact />)}
          </div>
        </div>
      </div>
    );
  }

  function TermsCard({ short }: { short?: boolean }) {
    if (!cond) return <div className="card small muted">{T('Для проекта не заведены условия')}</div>
    return (
      <div className="card">
        <div className="between"><div className="h3" style={{ margin: 0 }}>{ext ? T('Условия для агента') : T('Условия проекта')}</div>{short && <Link className="small bronze" href="?tab=terms">{T('Подробнее')} →</Link>}</div>
        <div className="mt8">
          {ext ? <>
            <div className="kv"><span>{T('Ваш фикс')}</span><span>{pct(L, cond.agent_fix_pct)} {T(cond.fix_base === 'list' ? 'от прайса' : 'от итоговой цены')}</span></div>
            <div className="kv"><span>{T('Ваша часть пула скидки')}</span><span>{pct(L, cond.agent_pool_pct)} {T('от прайса')}</span></div>
          </> : <>
            {seesDeveloperTerms(c.user.role) && <div className="kv"><span>{T('Фикс от застройщика')}</span><span>{pct(L, cond.fix_pct)} {T(cond.fix_base === 'list' ? 'от прайса' : 'от итоговой цены')}</span></div>}
            {seesDeveloperTerms(c.user.role) && <div className="kv"><span>{T('Пул скидки')}</span><span>{pct(L, cond.pool_pct)} {T('от прайса')}</span></div>}
            <div className="kv"><span>{T('Скидка продавца сам / с согласованием')}</span><span>{pct(L, cond.seller_self_disc)} / {pct(L, cond.seller_max_disc)}</span></div>
            <div className="kv"><span>{T('Агенту: фикс + часть пула')}</span><span>{pct(L, cond.agent_fix_pct)} + {pct(L, cond.agent_pool_pct)}</span></div>
          </>}
          <div className="kv"><span>{T('Закрепление клиента')}</span><span>{T('6 мес. после квалификации')}</span></div>{/* 2.2 §10: срок закрепления единый (было protect_months условий v2 — 3 мес., расходилось с карточкой клиента; QA 09.11) */}
          <div className="kv"><span>{T('Бронь')}</span><span>{T('{a} + {b} дней', { a: cond.booking_days, b: cond.booking_ext_days })}</span></div>
          {!short && dvl && <div className="kv"><span>{T('Лимит броней')}</span><span>{ext ? T('ваших — до {a} у застройщика', { a: dvl.person }) : T('клиент {c} · на человека {a} · у застройщика всего {t}', { c: cond.max_bookings_client, a: dvl.person, t: dvl.lim })}</span></div>}
          <div className="kv"><span>{T('Фиксация у застройщика')}</span><span>{T('через команду, 3–5 дней')}</span></div>
          {!short && <div className="kv"><span>{T('Выплата')}</span><span>{T('после оплаты застройщиком')}</span></div>}
          {plans.map((pl) => <div key={pl.id} className="kv"><span>{planLabel(T, pl.name, pl)}</span><span className="small">{isFull(pl) ? (Number(pl.full_payment_discount_pct) ? T('скидка {p}', { p: pct(L, Number(pl.full_payment_discount_pct)) }) : '100%') : (termUnknown(pl) ? T('взнос {p}, срок уточняется', { p: pct(L, Number(pl.down_payment_pct)) }) : T('взнос {p}, {m} мес.', { p: pct(L, Number(pl.down_payment_pct)), m: pl.months || 0 }))}</span></div>)}
          {finishes.length > 0 && <div className="kv"><span>{T('Отделка')}</span><span>{finishes.map((x) => T(FIN[x] || x)).join(', ')}</span></div>}
        </div>
        <div className="tiny muted mt8">{T('Версия условий {v} от {d}', { v: cond.version, d: date(L, cond.valid_from) })}</div>
      </div>
    )
  }

  function Terms() {
    const ex = p!.min_usd || 0
    return (
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <TermsCard />
        <div className="card">
          <div className="h3">{T('Варианты оплаты')}</div>
          {plans.length === 0 && <div className="small muted">{T('Условия рассрочки уточняются у застройщика.')}</div>}
          {plans.map((pl) => {
            const base = planBase(pl, ex), sc = schedule(pl, base)
            return (
              <div key={pl.id} className="kv"><span style={{ color: 'var(--ink)' }}>{planLabel(T, pl.name, pl)}{pl.source_note && <div className="tiny muted">{T(pl.source_note)}</div>}{(pl.valid_from || pl.valid_to) && <div className="tiny muted">{pl.valid_from ? T('с {d}', { d: date(L, pl.valid_from) }) : ''} {pl.valid_to ? T('до {d}', { d: date(L, pl.valid_to) }) : ''}</div>}</span>
                <span className="small" style={{ textAlign: 'end' }}>{isFull(pl) ? <>{Number(pl.full_payment_discount_pct) ? T('скидка {p}', { p: pct(L, Number(pl.full_payment_discount_pct)) }) : '100%'}</> : (termUnknown(pl) ? T('взнос {p}, срок уточняется', { p: pct(L, Number(pl.down_payment_pct)) }) : T('взнос {p}, {m} мес.', { p: pct(L, Number(pl.down_payment_pct)), m: pl.months || 0 }))}
                  {ex ? <div className="tiny muted">{sc.full ? T('к оплате {a}', { a: usd(L, base) }) : termUnknown(pl) ? T('взнос {d}, остаток по графику застройщика', { d: usd(L, sc.down) }) : T('взнос {d}, затем {m} × {x}', { d: usd(L, sc.down), m: sc.months, x: usd(L, sc.monthly) })}</div> : null}</span></div>
            )
          })}
          {ex ? <div className="tiny muted mt8">{T('Пример на квартире за {p}', { p: usd(L, ex) })}</div> : null}
        </div>
      </div>
    )
  }

  function FileRow({ f, compact }: { f: PF; compact?: boolean }) {
    const href = f.file_id ? `/files/${f.file_id}` : f.url!
    return (
      <div className="kv">
        <span style={{ color: 'var(--ink)' }}><a href={href} target="_blank" rel="noopener">{f.title}</a>
          {!compact && <div className="tiny muted">{f.file_id ? `${(f.mime || '').split('/').pop()?.toUpperCase()} · ${fmtSize(f.size || 0)}` : T('ссылка')} · {date(L, f.created_at)}</div>}</span>
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          <span className="tiny muted">{LANG_FLAG[f.lang]}</span>
          {!ext && !compact && f.audience !== 'partner' && <Pill kind={f.audience === 'team' ? 'warn' : 'ok'}>{T(f.audience === 'team' ? 'только команда' : 'можно клиенту')}</Pill>}
          {canEdit && !compact && <form action={deleteProjectFile}><input type="hidden" name="id" value={f.id} /><button className="btn btn--sm" title={T('Удалить')}>×</button></form>}
        </span>
      </div>
    )
  }

  function Files({ list, kind }: { list: PF[]; kind: 'material' | 'document' }) {
    const lang = searchParams.l
    const shown = lang ? list.filter((f) => f.lang === lang || f.lang === 'all') : list
    return (
      <div className="split">
        <div className="card">
          <div className="chips">{[['', 'Все языки'], ['ru', 'RU'], ['en', 'EN'], ['de', 'DE'], ['he', 'HE']].map(([k, l]) => <Link key={k} href={`?tab=${kind === 'material' ? 'materials' : 'docs'}${k ? '&l=' + k : ''}`} className={'chip' + ((lang || '') === k ? ' on' : '')}>{k ? l : T(l)}</Link>)}</div>
          <div className="mt8">
            {shown.length === 0 && <div className="small muted">{kind === 'material' ? T('Материалы пока не загружены.') : T('Документы пока не загружены.')}</div>}
            {shown.map((f) => <FileRow key={f.id} f={f} />)}
          </div>
          <div className="tiny muted mt16">{kind === 'material'
            ? T('Презентации, рендеры, планировки и видео для клиента — без контактов застройщика. Тексты и страница проекта для покупателей — на сайте рынка.')
            : T('Разрешения на строительство, образец договора, ход строительства. Внутренние документы с пометкой «только команда» партнёры не видят.')}</div>
        </div>
        {canEdit ? (
          <ActionForm action={saveProjectFile} lang={L} className="card stack" style={{ gap: 10 }} reset>
            <div className="h3" style={{ margin: 0 }}>{kind === 'material' ? T('Добавить материал') : T('Добавить документ')}</div>
            <input type="hidden" name="project" value={p!.id} />
            <label className="field"><span>{T('Название')}</span><input className="in" name="title" required placeholder={kind === 'material' ? T('Презентация проекта') : T('Разрешение на строительство')} /></label>
            {kind === 'material'
              ? <label className="field"><span>{T('Тип')}</span><select className="in" name="kind"><option value="material">{T('файл или ссылка')}</option><option value="video">{T('видео')}</option></select></label>
              : <input type="hidden" name="kind" value="document" />}
            <div className="row">
              <label className="field" style={{ flex: 1 }}><span>{T('Язык')}</span><select className="in" name="lang"><option value="all">{T('все языки')}</option>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
              <label className="field" style={{ flex: 1 }}><span>{T('Кому видно')}</span><select className="in" name="audience" defaultValue="partner"><option value="partner">{T('команда и партнёры')}</option><option value="client">{T('можно клиенту')}</option><option value="team">{T('только команда')}</option></select></label>
            </div>
            <label className="field"><span>{T('Файл (до 25 МБ)')}</span><input className="in" type="file" name="file" style={{ paddingTop: 6 }} /></label>
            <label className="field"><span>{T('или ссылка (облако, YouTube)')}</span><input className="in" name="url" placeholder="https://" /></label>
            <div><button className="btn btn--p">{T('Добавить')}</button></div>
            <div className="tiny muted">{T('Права на фото и видео — по договору с застройщиком; визуализации помечайте в названии.')}</div>
          </ActionForm>
        ) : <div className="card small muted">{T('Материалы загружают команда GetsEstate и контент-менеджер. Нужен материал на другом языке — напишите куратору.')}</div>}
      </div>
    )
  }
}
