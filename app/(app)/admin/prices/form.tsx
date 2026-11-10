import { q } from '@/lib/db'
import { t, type Lang } from '@/lib/i18n'
import { TYPE_NAME } from '@/lib/catalog'
import { OPS, ROUNDS, normRule, type PriceRule } from '@/lib/priceRule'
import { savePriceList } from '@/lib/priceActions'
import { ActionForm } from '@/components/ActionForm'

export const PL_STATUS: Record<string, [string, 'ok' | 'warn' | 'off']> = { draft: ['черновик', 'warn'], published: ['опубликован', 'ok'], reverted: ['откатан', 'off'] }
const STATUSES: [string, string][] = [['available', 'свободна'], ['reserved', 'бронь застройщика'], ['unavailable', 'не в продаже'], ['sold', 'продана']]

// Форма правила прайс-листа: кого меняем и как. Пустой отбор — все квартиры проекта с выбранными статусами.
export async function RuleForm({ lang, projectId, id, title, note, rule }: { lang: Lang; projectId: string; id?: string; title?: string; note?: string | null; rule?: PriceRule }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const r = rule || normRule({})
  const bs = await q<{ id: string; name: string }>('select id, name from buildings where project_id = $1 order by sort, name', [projectId])
  const ls = await q<{ id: string; code: string }>('select id, code from layouts where project_id = $1 order by code', [projectId])
  const types = (await q<{ unit_type: string }>('select distinct unit_type from units where project_id = $1', [projectId])).map((x) => x.unit_type)
  const curs = (await q<{ c: string }>('select distinct price_currency c from units where project_id = $1', [projectId])).map((x) => x.c)
  return (
    <ActionForm action={savePriceList} lang={lang} className="card stack" style={{ gap: 10 }} okText={T('Пересчитано, квартир')}>
      <div className="h3" style={{ margin: 0 }}>{id ? T('Правило прайс-листа') : T('Новый прайс-лист')}</div>
      <input type="hidden" name="project" value={projectId} />{id && <input type="hidden" name="id" value={id} />}
      <label className="field"><span>{T('Название')}</span><input className="in" name="title" defaultValue={title} placeholder={T('Повышение с 1 декабря')} /></label>
      <div className="label">{T('Кого меняем')}</div>
      {r.units.length > 0 && <div className="note small">{T('Отобрано в шахматке: {n} кв. — остальные условия отбора сужают этот список', { n: r.units.length })}{r.units.map((u) => <input key={u} type="hidden" name="units" value={u} />)}</div>}
      {bs.length > 1 && <div className="field"><span>{T('Корпуса')}</span><div className="chips">{bs.map((b) => <label key={b.id} className="chip chk"><input type="checkbox" name="buildings" value={b.id} defaultChecked={r.buildings.includes(b.id)} /> {b.name}</label>)}</div></div>}
      {types.length > 1 && <div className="field"><span>{T('Тип')}</span><div className="chips">{types.map((x) => <label key={x} className="chip chk"><input type="checkbox" name="types" value={x} defaultChecked={r.types.includes(x)} /> {T(TYPE_NAME[x] || x)}</label>)}</div></div>}
      <div className="field"><span>{T('Комнат')}</span><div className="chips">{[1, 2, 3, 4].map((x) => <label key={x} className="chip chk"><input type="checkbox" name="rooms" value={x} defaultChecked={r.rooms.includes(x)} /> {x === 4 ? '4+' : x}</label>)}</div></div>
      <div className="row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 1 }}><span>{T('Этажи с')}</span><input className="in" name="floor_from" type="number" defaultValue={r.floor_from ?? ''} /></label>
        <label className="field" style={{ flex: 1 }}><span>{T('по')}</span><input className="in" name="floor_to" type="number" defaultValue={r.floor_to ?? ''} /></label>
      </div>
      <label className="field"><span>{T('Стояки (через запятую)')}</span><input className="in" name="risers" defaultValue={r.risers.join(', ')} placeholder="01, 02, 08d" /></label>
      {ls.length > 0 && <label className="field"><span>{T('Планировки')}</span><select key={`layouts:${String(r.layouts)}`} className="in" name="layouts" multiple defaultValue={r.layouts} style={{ height: 90 }}>{ls.map((l) => <option key={l.id} value={l.id}>{l.code}</option>)}</select></label>}
      <div className="field"><span>{T('Статусы')}</span><div className="chips">{STATUSES.map(([k, l]) => <label key={k} className="chip chk"><input type="checkbox" name="statuses" value={k} defaultChecked={r.statuses.includes(k)} /> {T(l)}</label>)}</div></div>
      <div className="label mt8">{T('Как меняем')}</div>
      <label className="field"><span>{T('Действие')}</span><select key={`op:${String(r.op)}`} className="in" name="op" defaultValue={r.op}>{OPS.map(([k, l]) => <option key={k} value={k}>{T(l)}</option>)}</select></label>
      <div className="row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 2 }}><span>{T('Значение')}</span><input className="in" name="value" inputMode="decimal" defaultValue={r.value || ''} required placeholder="3" /></label>
        <label className="field" style={{ flex: 1 }}><span>{T('Валюта суммы')}</span><select key={`currency:${String(r.currency || curs[0] || 'USD')}`} className="in" name="currency" defaultValue={r.currency || curs[0] || 'USD'}>{(curs.length ? curs : ['USD']).map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      <div className="row" style={{ gap: 6 }}>
        <label className="field" style={{ flex: 1 }}><span>{T('Базовый этаж (для шага по этажам)')}</span><input className="in" name="base_floor" type="number" defaultValue={r.base_floor ?? ''} /></label>
        <label className="field" style={{ flex: 1 }}><span>{T('Округлить до')}</span><select key={`round:${String(String(r.round))}`} className="in" name="round" defaultValue={String(r.round)}>{ROUNDS.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
      </div>
      <label className="field"><span>{T('Комментарий')}</span><input className="in" name="note" defaultValue={note || ''} placeholder={T('Письмо застройщика от …')} /></label>
      <div><button className="btn btn--p">{id ? T('Пересчитать') : T('Создать черновик')}</button></div>
      <div className="tiny muted">{T('Процент и шаг по этажам считаются от текущей цены. Сумма, цена и цена за м² — только для квартир в выбранной валюте. Публикация пропустит квартиры, чья цена изменилась после расчёта.')}</div>
    </ActionForm>
  )
}
