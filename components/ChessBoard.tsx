'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { t, usd, num, type Lang, m2u } from '@/lib/i18n'
import { normFilter, matchUnit } from '@/lib/unitMatch.mjs'

// Шахматка блока (уровня Profitbase): компактный вид и «Шахматка+», мгновенная подсветка по фильтрам каталога,
// карточка при наведении, итоги по этажам и стоякам, выделение нескольких квартир и действия над ними.
export type CU = {
  id: string; no: string; riser: string; floor: number; code: string; rooms: number | null; area: number; out: number; type: string; typeName: string
  usd: number | null; net: number | null; promo: string | null; plan: string | null; view_side: string | null; orient: string; layout: string | null
  plot_area: number | null; ext_area: number | null; is_corner: boolean | null; building_id: string; project_id: string; hidden: boolean
}
type Mode = 'price' | 'm2' | 'rooms' | 'area'
const STATUS: [string, string][] = [['F', 'Свободно'], ['M', 'Ваша бронь'], ['O', 'Наша бронь'], ['D', 'Наша сделка'], ['B', 'Бронь застройщика'], ['S', 'Продано'], ['N', 'Не в продаже'], ['SB', 'Передана агентству (Sea Breeze)'], ['X', 'Недоступно']]

export function ChessBoard({ units, lang, team, selected, hrefFor, views, layouts, clients, bulk, projectId, canPick, initial }: {
  units: CU[]; lang: Lang; team: boolean; selected?: string; hrefFor: Record<string, string>; views: [string, string][]; layouts: string[]
  clients: { id: string; name: string }[]; projectId: string; canPick: boolean; initial?: Record<string, string>
  bulk?: { toSelection: (f: FormData) => Promise<void>; status?: (f: FormData) => Promise<void>; hide?: (f: FormData) => Promise<void> }
}) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const router = useRouter()
  const [big, setBig] = useState(false)
  const [mode, setMode] = useState<Mode>('price')
  const [f, setF] = useState<Record<string, string>>(initial || {})
  const [hide, setHide] = useState<string[]>([])
  // В9/М3 (ревью 10.11): в одну строку — комнаты, цена, площадь; остальное — под «Ещё фильтры» (раскрыто, если там что-то выбрано)
  const EXTRA = ['t', 'fmin', 'fmax', 'v', 'l', 'promo', 'c']
  const extraN = EXTRA.filter((k) => f[k]).length
  const [more, setMore] = useState(extraN > 0)
  const [pick, setPick] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [hover, setHover] = useState<{ u: CU; x: number; y: number } | null>(null)
  const set = (k: string, v: string) => setF((o) => ({ ...o, [k]: v }))
  const toggle = (k: string, v: string) => setF((o) => { const a = (o[k] || '').split(',').filter(Boolean); return { ...o, [k]: (a.includes(v) ? a.filter((x) => x !== v) : [...a, v]).join(',') } })
  const has = (k: string, v: string) => (f[k] || '').split(',').includes(v)
  const nf = useMemo(() => normFilter({ types: f.t, rooms: f.r, pmin: f.pmin ? Number(f.pmin) * 1000 : '', pmax: f.pmax ? Number(f.pmax) * 1000 : '', amin: f.amin, amax: f.amax, fmin: f.fmin, fmax: f.fmax, view: f.v, promo: f.promo, corner: f.c }), [f])
  const active = Object.values(f).some(Boolean)
  const ok = (u: CU) => !hide.includes(u.code) && (!f.l || u.layout === f.l) && (!active || matchUnit({ ...u, unit_type: u.type }, nf))
  const cols = useMemo(() => Array.from(new Set(units.map((u) => u.riser))).sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0) || a.localeCompare(b)), [units])
  const floors = useMemo(() => Array.from(new Set(units.map((u) => u.floor))).sort((a, b) => b - a), [units])
  const at = useMemo(() => new Map(units.map((u) => [`${u.floor}|${u.riser}`, u])), [units])
  const counts = units.reduce((a, u) => { a[u.code] = (a[u.code] || 0) + 1; return a }, {} as Record<string, number>)
  const freeAt = (pred: (u: CU) => boolean) => units.filter((u) => pred(u) && u.code === 'F')
  const shown = units.filter((u) => ok(u) && u.code === 'F')
  const k = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : Math.round(n / 1000) + 'k')
  const val = (u: CU) => {
    if (u.code === 'X') return ''
    if (mode === 'rooms') return u.rooms ? `${u.rooms}${T('к')}` : T(u.typeName)
    if (mode === 'area') return `${Math.round(u.area)} ${m2u(lang)}`
    const p = u.net ?? u.usd
    if (!p || (!team && u.code !== 'F')) return ''
    return mode === 'm2' ? '$' + num(lang, Math.round(p / (u.area + u.out))) : (big ? usd(lang, p) : k(p))
  }
  const click = (u: CU, e: React.MouseEvent) => {
    setHover(null) // В1: после клика подсказка не висит поверх панели и фильтров
    if (!pick) return
    e.preventDefault()
    if (u.code === 'X') return
    setPicked((a) => (a.includes(u.id) ? a.filter((x) => x !== u.id) : [...a, u.id]))
  }
  const pickedUnits = units.filter((u) => picked.includes(u.id))
  const Hidden = () => <>{picked.map((id) => <input key={id} type="hidden" name="units" value={id} />)}<input type="hidden" name="project" value={projectId} /></>
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card card--tight stack" style={{ gap: 10 }}>
        <div className="between">
          <div className="chips">
            {(['price', 'm2', 'rooms', 'area'] as Mode[]).map((m) => <button key={m} type="button" className={'chip' + (mode === m ? ' on' : '')} onClick={() => setMode(m)}>{T(m === 'price' ? 'Цена' : m === 'm2' ? '$/м²' : m === 'rooms' ? 'Комнаты' : 'Площадь')}</button>)}
            <span style={{ width: 8 }} />
            <button type="button" className={'chip' + (!big ? ' on' : '')} onClick={() => setBig(false)}>{T('Компактно')}</button>
            <button type="button" className={'chip' + (big ? ' on' : '')} onClick={() => setBig(true)}>{T('Шахматка+')}</button>
          </div>
          <div className="chips">
            {canPick && <button type="button" className={'chip' + (pick ? ' on' : '')} onClick={() => { setPick(!pick); setPicked([]) }}>{pick ? T('Готово') : T('Выбрать несколько')}</button>}
            {active && <button type="button" className="chip" onClick={() => setF({})}>{T('Сбросить фильтр')}</button>}
          </div>
        </div>
        <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
          <div className="chips">{[1, 2, 3, 4].map((r) => <button key={r} type="button" className={'chip' + (has('r', String(r)) ? ' on' : '')} onClick={() => toggle('r', String(r))}>{r === 4 ? '4+' : r}{T('к')}</button>)}</div>
          <label className="field" style={{ width: 150 }}><span>{T('Цена, тыс. $')}</span><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="in" inputMode="numeric" placeholder={T('от')} value={f.pmin || ''} onChange={(e) => set('pmin', e.target.value)} /><input className="in" inputMode="numeric" placeholder={T('до')} value={f.pmax || ''} onChange={(e) => set('pmax', e.target.value)} /></div></label>
          <label className="field" style={{ width: 130 }}><span>{T('Площадь, м²')}</span><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="in" inputMode="decimal" placeholder={T('от')} value={f.amin || ''} onChange={(e) => set('amin', e.target.value)} /><input className="in" inputMode="decimal" placeholder={T('до')} value={f.amax || ''} onChange={(e) => set('amax', e.target.value)} /></div></label>
          <button type="button" className={'chip' + (more ? ' on' : '')} aria-expanded={more} onClick={() => setMore(!more)}>{T('Ещё фильтры')}{extraN ? ` · ${extraN}` : ''} {more ? '▴' : '▾'}</button>
        </div>
        {more && <div className="row" style={{ gap: 14, alignItems: 'flex-end' }}>
          {Array.from(new Set(units.map((u) => u.type))).length > 1 && <div className="chips">{Array.from(new Map(units.map((u) => [u.type, u.typeName])).entries()).map(([ty, n]) => <button key={ty} type="button" className={'chip' + (has('t', ty) ? ' on' : '')} onClick={() => toggle('t', ty)}>{T(n)}</button>)}</div>}
          <label className="field" style={{ width: 110 }}><span>{T('Этаж')}</span><div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}><input className="in" inputMode="numeric" placeholder={T('от')} value={f.fmin || ''} onChange={(e) => set('fmin', e.target.value)} /><input className="in" inputMode="numeric" placeholder={T('до')} value={f.fmax || ''} onChange={(e) => set('fmax', e.target.value)} /></div></label>
          {views.length > 0 && <label className="field" style={{ width: 150 }}><span>{T('Вид из окон')}</span><select className="in" value={f.v || ''} onChange={(e) => set('v', e.target.value)}><option value="">{T('любой')}</option>{views.map(([v, l]) => <option key={v} value={v}>{T(l)}</option>)}</select></label>}
          {layouts.length > 1 && <label className="field" style={{ width: 130 }}><span>{T('Планировка')}</span><select className="in" value={f.l || ''} onChange={(e) => set('l', e.target.value)}><option value="">{T('любая')}</option>{layouts.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>}
          <div className="row" style={{ gap: 14, flexWrap: 'nowrap' }}>
            <label className="check"><input type="checkbox" checked={!!f.promo} onChange={(e) => set('promo', e.target.checked ? '1' : '')} /> <span>{T('С акцией')}</span></label>
            <label className="check"><input type="checkbox" checked={!!f.c} onChange={(e) => set('c', e.target.checked ? '1' : '')} /> <span>{T('Угловая')}</span></label>
          </div>
        </div>}
        <div className="legend">{STATUS.filter(([c]) => counts[c]).map(([c, l0]) => { const l = !team && c === 'O' ? 'Бронь' : l0 /* 312: у партнёра — «Бронь» */; return (
          <button key={c} type="button" className="legend__b" style={{ opacity: hide.includes(c) ? 0.4 : 1 }} title={T('Скрыть или показать')} onClick={() => setHide((a) => (a.includes(c) ? a.filter((x) => x !== c) : [...a, c]))}><i className={`c-${c}`} />{T(l)} <b>{counts[c]}</b></button>) })}
          <span className="small muted" style={{ marginInlineStart: 'auto' }}>{active ? T('Под фильтр: {n} свободных', { n: shown.length }) : T('Свободно {f} из {n}', { f: counts.F || 0, n: units.length })}</span>
        </div>
      </div>

      <div className={'chess' + (big ? ' chess--big' : '')} onMouseLeave={() => setHover(null)}>
        <table>
          <thead><tr><th />{cols.map((c) => { const fr = freeAt((u) => u.riser === c).length; const any = units.find((u) => u.riser === c); return <th key={c} title={any?.layout || ''}>{c.toUpperCase()}<div className="tiny muted" style={{ fontWeight: 400 }}>{fr || '·'}</div></th> })}</tr></thead>
          <tbody>
            {floors.map((fl) => {
              const fr = freeAt((u) => u.floor === fl)
              return (
                <tr key={fl}>
                  <td className="fl">{fl}<div className="tiny muted" style={{ fontWeight: 400 }}>{fr.length ? fr.length + ' · ' + k(Math.min(...fr.map((u) => u.net ?? u.usd ?? Infinity))) : '—'}</div></td>
                  {cols.map((c) => {
                    const u = at.get(`${fl}|${c}`)
                    if (!u) return <td key={c} />
                    const dim = !ok(u)
                    const cls = `cell c-${u.code}${u.id === selected ? ' sel' : ''}${dim ? ' dim' : ''}${picked.includes(u.id) ? ' picked' : ''}`
                    const inner = <span className={cls} onMouseEnter={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); if (u.code !== 'X') setHover({ u, x: r.right, y: r.top }) }}>
                      <b>{u.code === 'X' ? '' : u.riser.toUpperCase()}{u.promo && u.code === 'F' ? <i className="cell__promo">%</i> : null}</b>
                      {big && u.code !== 'X' && <span className="cell__meta">{u.rooms ? `${u.rooms}${T('к')} · ` : ''}{Math.round(u.area)} м²</span>}
                      <span className="cell__v">{val(u)}</span>
                    </span>
                    return <td key={c}>{u.code === 'X' ? inner : <Link href={hrefFor[u.id]} scroll={false} onClick={(e) => click(u, e)}>{inner}</Link>}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
        {hover && !pick && (
          <div className="hovercard" style={{ left: Math.min(hover.x + 8, (typeof window !== 'undefined' ? window.innerWidth : 1400) - 270), top: Math.max(8, Math.min(hover.y - 20, (typeof window !== 'undefined' ? window.innerHeight : 900) - 330)) }}>
            {hover.u.plan ? <img src={hover.u.plan} alt="" /> : <div className="tiny muted">{T('планировка не загружена')}</div>}
            <div className="between mt8"><b>{hover.u.no}</b><span className="tiny">{T(STATUS.find(([c]) => c === hover.u.code)?.[1] || '')}</span></div>
            <div className="small">{hover.u.rooms ? T('{r} комн.', { r: hover.u.rooms }) + ' · ' : T(hover.u.typeName) + ' · '}{num(lang, hover.u.area, 1)} м²{hover.u.out ? ` + ${num(lang, hover.u.out, 1)}` : ''} · {T('{f} этаж', { f: hover.u.floor })}</div>
            {hover.u.orient && <div className="tiny muted">{hover.u.orient}</div>}
            {(team || hover.u.code === 'F') && hover.u.usd ? <div className="mt8"><b>{usd(lang, hover.u.net ?? hover.u.usd)}</b>{hover.u.promo ? <> <s className="tiny muted">{usd(lang, hover.u.usd)}</s> <span className="tiny bronze">{hover.u.promo}</span></> : null}<div className="tiny muted">{usd(lang, (hover.u.net ?? hover.u.usd) / (hover.u.area + hover.u.out))}/{m2u(lang)}{hover.u.layout ? ' · ' + hover.u.layout : ''}</div></div> : null}
            {team && hover.u.hidden && <div className="tiny warnc">{T('скрыта от партнёров')}</div>}
          </div>
        )}
      </div>

      {pick && (
        <div className="card card--tight pickbar">
          <span className="small"><b>{T('Выбрано: {n}', { n: picked.length })}</b>{picked.length ? ' · ' + pickedUnits.slice(0, 6).map((u) => u.no).join(', ') + (picked.length > 6 ? '…' : '') : ' · ' + T('нажимайте на квартиры')}</span>
          {picked.length > 0 && <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn--sm" onClick={() => setPicked(shown.map((u) => u.id))}>{T('Все свободные по фильтру')}</button>
            {clients.length > 0 && <form action={async (fd) => { await bulk!.toSelection(fd); setPicked([]); router.refresh() }} className="row" style={{ gap: 6 }}><Hidden />
              <select className="in" name="client" required defaultValue="" style={{ width: 190 }}><option value="" disabled>{T('Клиент')}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <button className="btn btn--sm btn--p">{T('В подборку')}</button></form>}
            {bulk?.status && <form action={async (fd) => { await bulk.status!(fd); setPicked([]); router.refresh() }} className="row" style={{ gap: 6 }}><Hidden />
              <select className="in" name="status" defaultValue="available" style={{ width: 160 }}>{[['available', 'свободна'], ['reserved', 'бронь застройщика'], ['sold', 'продана'], ['unavailable', 'не в продаже']].map(([s, l]) => <option key={s} value={s}>{T(l)}</option>)}</select>
              <button className="btn btn--sm">{T('Сменить статус')}</button></form>}
            {bulk?.hide && <form action={async (fd) => { await bulk.hide!(fd); setPicked([]); router.refresh() }} className="row" style={{ gap: 6 }}><Hidden />
              <button className="btn btn--sm" name="hidden" value="1">{T('Скрыть от партнёров')}</button><button className="btn btn--sm" name="hidden" value="0">{T('Открыть партнёрам')}</button></form>}
            {bulk?.status && <Link className="btn btn--sm" href={`/admin/prices?p=${projectId}&units=${picked.join(',')}`}>{T('Прайс-лист из выбранных')} →</Link>}
          </div>}
        </div>
      )}
    </div>
  )
}
