import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { one, q } from '@/lib/db'
import { t, usd, pct, date } from '@/lib/i18n'
import { projectBySlug, buildingsOf, conditionsFor, plansFor } from '@/lib/catalog'
import { isFull, schedule, planBase } from '@/lib/plans'
import { isExternal, seesDeveloperTerms } from '@/lib/perm'
import { fmtSize } from '@/lib/files'
import { Top, Pill, SALES } from '@/components/ui'
import { ActionForm } from '@/components/ActionForm'
import { saveProjectFile, deleteProjectFile } from '@/lib/content'

type PF = { id: string; kind: string; title: string; lang: string; audience: string; file_id: string | null; url: string | null; size: number | null; mime: string | null; created_at: string }
const LANG_FLAG: Record<string, string> = { all: 'RU EN DE HE', ru: 'RU', en: 'EN', de: 'DE', he: 'HE' }

// Рабочая страница проекта (ТЗ, «Портал и CMS»): генплан и шахматка, условия, материалы для клиента, документы и ссылка на страницу проекта на сайте рынка.
// Полный контент и дизайн проекта — в CMS и на сайте.
export default async function ProjectPage({ params, searchParams }: { params: { slug: string }; searchParams: { tab?: string; l?: string } }) {
  const c = await requireCtx()
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const p = await projectBySlug(params.slug, c.user)
  if (!p) notFound()
  const bs = await buildingsOf(p.id, c.user)
  const ext = isExternal(c.user.role)
  const cond = await conditionsFor(p.id, ext ? c.user : null)
  const plans = await plansFor(p.id, null)
  const ps = await one<{ site_urls: Record<string, string> }>('select site_urls from portal.project_settings where project_id = $1', [p.id])
  const site = ps?.site_urls?.[c.user.market || ''] || ps?.site_urls?.GLOBAL || Object.values(ps?.site_urls || {})[0]
  const files = await q<PF>(`select pf.id, pf.kind, pf.title, pf.lang, pf.audience, pf.file_id, pf.url, f.size::int, f.mime, pf.created_at from portal.project_files pf left join portal.files f on f.id = pf.file_id
    where pf.project_id = $1 ${ext ? "and pf.audience <> 'team'" : ''} order by pf.kind, pf.sort, pf.created_at`, [p.id])
  const canEdit = ['owner', 'content'].includes(c.user.role)
  const tab = ['terms', 'materials', 'docs'].includes(searchParams.tab || '') ? searchParams.tab! : 'plan'
  const mats = files.filter((f) => f.kind !== 'document'), docs = files.filter((f) => f.kind === 'document')
  const sales = SALES[p.sales_status] || SALES.draft
  const deliveries = Array.from(new Set(bs.map((b) => b.delivery).filter(Boolean)))
  const tabs: [string, string, string][] = [['plan', 'Генплан', `/projects/${p.slug}`], ['chess', 'Шахматка', `/projects/${p.slug}/chess`], ['list', 'Список', `/catalog?p=${p.slug}`],
    ['terms', 'Условия', `?tab=terms`], ['materials', `${T('Материалы')} · ${mats.length}`, `?tab=materials`], ['docs', `${T('Документы')} · ${docs.length}`, `?tab=docs`]]
  return (
    <>
      <Top crumbs={[[T('Проекты'), '/projects'], [p.name]]} title={p.name}
        sub={<span className="row" style={{ gap: 8, marginTop: 6 }}>{p.sales_status !== 'sales' && <Pill kind={sales[1]}>{T(sales[0])}</Pill>}<span className="small muted">{p.developer} · {p.city || 'Баку'}{p.location ? ' · ' + p.location : ''}</span></span>}
        right={<>{site && <a className="btn" href={site} target="_blank" rel="noopener">{T('На сайте')} ↗</a>}<Link className="btn btn--p" href={`/projects/${p.slug}/chess`}>{T('Шахматка')}</Link></>} />
      <div className="page">
        <div className="grid g4" style={{ marginBottom: 16 }}>
          {[[String(p.free), T('свободно из {n}', { n: p.units })], [p.min_usd ? usd(L, p.min_usd) : '—', T('цена от, по прайсу застройщика')], [deliveries.join(' · ') || p.delivery || T('уточняется'), T('срок сдачи')], [String(bs.length), T('блоков · без ремонта')]].map(([a, b]) => (
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
    const gp = await one<{ image: string; polygons: { block: string; points: [number, number][]; label: [number, number] }[]; note: string }>('select image, polygons, note from portal.genplans where project_id = $1', [p!.id])
    const byExt = Object.fromEntries(bs.map((b) => [b.external_id || b.name, b]))
    return (
      <div className="split">
        <div>
          {gp ? (
            <div className="gp">
              <img src={gp.image} alt="" />
              <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                {gp.polygons.map((g) => byExt[g.block] && <a key={g.block} href={`/projects/${p!.slug}/chess?b=${byExt[g.block].id}`}><polygon points={g.points.map((x) => x.join(',')).join(' ')} /></a>)}
              </svg>
              {gp.polygons.map((g) => byExt[g.block] && (
                <div key={g.block} className="tag" style={{ left: `${g.label[0] * 100}%`, top: `${g.label[1] * 100}%` }}>
                  <b>{byExt[g.block].name}</b>{T('{n} свободно', { n: byExt[g.block].free })}{byExt[g.block].min_usd ? ' · ' + T('от {p}', { p: usd(L, byExt[g.block].min_usd!) }) : ''}
                </div>
              ))}
            </div>
          ) : <div className="card small muted">{T('Генплан с контурами домов появится после загрузки — пока выберите блок ниже.')}</div>}
          {gp?.note && !ext && <div className="small bronze mt8">{T(gp.note)}</div>}
          <div className="grid g4 mt16">
            {bs.map((b) => <Link key={b.id} href={`/projects/${p!.slug}/chess?b=${b.id}`} className="card card--tight"><b>{b.name}</b><div className="small muted">{T('{n} свободно', { n: b.free })} / {b.units}{b.min_usd ? ' · ' + T('от {p}', { p: usd(L, b.min_usd) }) : ''}</div>{b.delivery && <div className="tiny muted">{T('сдача')}: {b.delivery}</div>}</Link>)}
          </div>
        </div>
        <div className="stack">
          <TermsCard short />
          <div className="card">
            <div className="between"><div className="h3" style={{ margin: 0 }}>{T('Материалы для клиента')}</div><Link className="small bronze" href="?tab=materials">{T('Все')} →</Link></div>
            {mats.length === 0 && <div className="small muted mt8">{T('Материалы пока не загружены.')}</div>}
            {mats.slice(0, 5).map((f) => <FileRow key={f.id} f={f} compact />)}
          </div>
        </div>
      </div>
    )
  }

  function TermsCard({ short }: { short?: boolean }) {
    if (!cond) return <div className="card small muted">{T('Для проекта не заведены условия')}</div>
    return (
      <div className="card">
        <div className="between"><div className="h3" style={{ margin: 0 }}>{ext ? T('Условия для агента') : T('Условия проекта')}</div>{short && <Link className="small bronze" href="?tab=terms">{T('Подробнее')} →</Link>}</div>
        <div className="mt8">
          {ext ? <>
            <div className="kv"><span>{T('Ваш фикс')}</span><span>{pct(L, cond.agent_fix_pct)} {T('от итоговой цены')}</span></div>
            <div className="kv"><span>{T('Ваша часть пула скидки')}</span><span>{pct(L, cond.agent_pool_pct)} {T('от прайса')}</span></div>
          </> : <>
            {seesDeveloperTerms(c.user.role) && <div className="kv"><span>{T('Фикс от застройщика')}</span><span>{pct(L, cond.fix_pct)} {T('от итоговой цены')}</span></div>}
            {seesDeveloperTerms(c.user.role) && <div className="kv"><span>{T('Пул скидки')}</span><span>{pct(L, cond.pool_pct)} {T('от прайса')}</span></div>}
            <div className="kv"><span>{T('Скидка продавца сам / с согласованием')}</span><span>{pct(L, cond.seller_self_disc)} / {pct(L, cond.seller_max_disc)}</span></div>
            <div className="kv"><span>{T('Агенту: фикс + часть пула')}</span><span>{pct(L, cond.agent_fix_pct)} + {pct(L, cond.agent_pool_pct)}</span></div>
          </>}
          <div className="kv"><span>{T('Защита клиента')}</span><span>{T('{m} мес.', { m: cond.protect_months })}</span></div>
          <div className="kv"><span>{T('Бронь')}</span><span>{T('{a} + {b} дней', { a: cond.booking_days, b: cond.booking_ext_days })}</span></div>
          {!short && <div className="kv"><span>{T('Лимит броней')}</span><span>{T('клиент {c} · агент {a} · всего {t}', { c: cond.max_bookings_client, a: cond.max_bookings_agent, t: cond.max_bookings_total })}</span></div>}
          <div className="kv"><span>{T('Фиксация у застройщика')}</span><span>{T('через команду, 3–5 дней')}</span></div>
          {!short && <div className="kv"><span>{T('Выплата')}</span><span>{T('после оплаты застройщиком')}</span></div>}
          {plans.map((pl) => <div key={pl.id} className="kv"><span>{pl.name}</span><span className="small">{isFull(pl) ? (Number(pl.full_payment_discount_pct) ? T('скидка {p}', { p: pct(L, Number(pl.full_payment_discount_pct)) }) : '100%') : T('взнос {p}, {m} мес.', { p: pct(L, Number(pl.down_payment_pct)), m: pl.months || 0 })}</span></div>)}
          <div className="kv"><span>{T('Отделка')}</span><span>{T('без ремонта')}</span></div>
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
              <div key={pl.id} className="kv"><span style={{ color: 'var(--ink)' }}>{pl.name}{pl.source_note && <div className="tiny muted">{pl.source_note}</div>}{(pl.valid_from || pl.valid_to) && <div className="tiny muted">{pl.valid_from ? T('с {d}', { d: date(L, pl.valid_from) }) : ''} {pl.valid_to ? T('до {d}', { d: date(L, pl.valid_to) }) : ''}</div>}</span>
                <span className="small" style={{ textAlign: 'end' }}>{isFull(pl) ? <>{Number(pl.full_payment_discount_pct) ? T('скидка {p}', { p: pct(L, Number(pl.full_payment_discount_pct)) }) : '100%'}</> : T('взнос {p}, {m} мес.', { p: pct(L, Number(pl.down_payment_pct)), m: pl.months || 0 })}
                  {ex ? <div className="tiny muted">{sc.full ? T('к оплате {a}', { a: usd(L, base) }) : T('взнос {d}, затем {m} × {x}', { d: usd(L, sc.down), m: sc.months, x: usd(L, sc.monthly) })}</div> : null}</span></div>
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
