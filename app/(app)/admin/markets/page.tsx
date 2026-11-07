import { redirect } from 'next/navigation'
import { requireCtx } from '@/lib/auth'
import { q } from '@/lib/db'
import { t } from '@/lib/i18n'
import { Top } from '@/components/ui'
import { AdminTabs } from '@/components/AdminTabs'
import { saveMarket, saveOffice, saveDict } from '@/lib/marketActions'

// 2.2 · Рынки (часы, SLA, переговоры о цене — 270), офисы продаж, словари (причины Lost, сегменты, слова-табу — 271, причины отказа брони)
const KINDS: [string, string][] = [['lost_reason', 'Причины Lost'], ['segment', 'Сегменты'], ['taboo', 'Слова-табу (предупреждение)'], ['decline_reason', 'Причины отказа брони']]
export default async function Markets() {
  const c = await requireCtx()
  if (!['owner', 'market_head'].includes(c.user.role)) redirect('/')
  const L = c.lang, T = (s: string, v?: Record<string, string | number>) => t(L, s, v)
  const edit = c.user.role === 'owner'
  const markets = await q<{ code: string; name: string; countries: string; entity: string; currency: string; tz: string; workdays: number[]; wf: string; wt: string; sla_minutes: number; price_negotiation: boolean; languages: string[]; mailbox: string | null }>(
    `select code, name, countries, entity, currency, tz, workdays, to_char(work_from, 'HH24:MI') wf, to_char(work_to, 'HH24:MI') wt, sla_minutes, price_negotiation, languages, mailbox from portal.markets order by array_position(array['DE','IL','GLOBAL'], code)`)
  const offices = await q<{ id: string; market: string; city: string; address: string | null; phone: string | null; schedule: string | null; tz: string }>('select * from portal.offices order by market, city')
  const dict = await q<{ kind: string; code: string; label: string; market: string }>('select kind, code, label, market from portal.dict order by kind, sort, label')
  return (
    <>
      <Top crumbs={[[T('Админка'), '/admin'], [T('Рынки и справочники')]]} title={T('Рынки и справочники')} sub={T('Рабочее время и SLA первого ответа по рынку, переговоры о цене, офисы продаж, причины Lost, сегменты и слова-табу')} />
      <div className="page stack">
        <AdminTabs lang={L} on="markets" role={c.user.role} />
        <div className="grid g3">{markets.map((m) => (
          <form key={m.code} action={saveMarket} className="card stack" style={{ gap: 8 }}>
            <input type="hidden" name="code" value={m.code} />
            <div className="h3" style={{ margin: 0 }}>{m.name}</div>
            <div className="tiny muted">{m.countries} · {m.entity} · {m.currency} · {m.tz}</div>
            <label className="check"><input type="checkbox" name="price_negotiation" defaultChecked={m.price_negotiation} disabled={!edit} /> {T('Переговоры о цене разрешены')}</label>
            <div className="tiny muted">{T('Выключено — скидку и бронь запрашивает руководитель Global')}</div>
            <div className="row" style={{ gap: 6 }}><label className="field"><span>{T('Рабочий день с')}</span><input className="in" type="time" name="work_from" defaultValue={m.wf} disabled={!edit} /></label><label className="field"><span>{T('до')}</span><input className="in" type="time" name="work_to" defaultValue={m.wt} disabled={!edit} /></label></div>
            <label className="field"><span>{T('Рабочие дни (1 — пн … 7 — вс)')}</span><input className="in" name="workdays" defaultValue={m.workdays.join(', ')} disabled={!edit} /></label>
            <label className="field"><span>{T('SLA первого ответа, мин')}</span><input className="in" name="sla_minutes" type="number" defaultValue={m.sla_minutes} disabled={!edit} /></label>
            <label className="field"><span>{T('Ящик рынка (копия каждой заявки с сайта)')}</span><input className="in" name="mailbox" type="email" defaultValue={m.mailbox || ''} placeholder="de@getsestate.com" disabled={!edit} /></label>
            <label className="field"><span>{T('Языки рынка')}</span><input className="in" name="languages" defaultValue={m.languages.join(', ')} disabled={!edit} /></label>
            {edit && <div><button className="btn btn--sm">{T('Сохранить')}</button></div>}
          </form>))}</div>
        <div className="card stack" style={{ gap: 8 }}>
          <div className="h3" style={{ margin: 0 }}>{T('Офисы продаж')}</div>
          <div className="tiny muted">{T('Адрес, телефон, недельный график и часовой пояс — для записи на показ, автоответов вне рабочего времени и контактов в подборках')}</div>
          {offices.map((o) => <form key={o.id} action={saveOffice} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}><input type="hidden" name="id" value={o.id} />
            <span className="small" style={{ width: 60 }}>{o.market}</span><input className="in" name="city" defaultValue={o.city} style={{ width: 120 }} disabled={!edit} /><input className="in" name="address" defaultValue={o.address || ''} placeholder={T('Адрес')} style={{ width: 240 }} disabled={!edit} />
            <input className="in" name="phone" defaultValue={o.phone || ''} placeholder={T('Телефон')} style={{ width: 150 }} disabled={!edit} /><input className="in" name="schedule" defaultValue={o.schedule || ''} placeholder={T('пн–пт 9–18')} style={{ width: 160 }} disabled={!edit} /><input className="in" name="tz" defaultValue={o.tz} style={{ width: 140 }} disabled={!edit} />
            {edit && <><button className="btn btn--sm">{T('Сохранить')}</button><button className="btn btn--sm btn--ghost" name="delete" value="1">×</button></>}</form>)}
          {edit && <form action={saveOffice} className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <select className="in" name="market" style={{ width: 90 }}>{['DE', 'IL', 'GLOBAL'].map((m) => <option key={m}>{m}</option>)}</select><input className="in" name="city" placeholder={T('Город')} style={{ width: 120 }} required />
            <input className="in" name="address" placeholder={T('Адрес')} style={{ width: 240 }} /><input className="in" name="phone" placeholder={T('Телефон')} style={{ width: 150 }} /><input className="in" name="schedule" placeholder={T('пн–пт 9–18')} style={{ width: 160 }} />
            <input className="in" name="tz" placeholder="Europe/Berlin" style={{ width: 140 }} /><button className="btn btn--sm btn--p">{T('+ Офис')}</button></form>}
        </div>
        <div className="grid g2">{KINDS.map(([k, l]) => (
          <div key={k} className="card stack" style={{ gap: 6 }}>
            <div className="h3" style={{ margin: 0 }}>{T(l)}</div>
            <div className="chips">{dict.filter((d) => d.kind === k).map((d) => <form key={d.code + d.market} action={saveDict} className="chip"><input type="hidden" name="kind" value={k} /><input type="hidden" name="code" value={d.code} /><input type="hidden" name="market" value={d.market} />
              {d.label}{d.market ? <span className="n">{d.market}</span> : null}{edit && <button name="delete" value="1" className="btn btn--sm btn--ghost" style={{ padding: '0 4px', height: 18 }}>×</button>}</form>)}</div>
            {edit && <form action={saveDict} className="row" style={{ gap: 6 }}><input type="hidden" name="kind" value={k} /><input className="in" name="label" placeholder={T('Значение')} style={{ flex: 1 }} required />
              <select className="in" name="market" style={{ width: 100 }}><option value="">{T('все рынки')}</option>{['DE', 'IL', 'GLOBAL'].map((m) => <option key={m}>{m}</option>)}</select><button className="btn btn--sm">+</button></form>}
          </div>))}</div>
        <div className="tiny muted">{T('Причины Lost и сегменты в Bitrix24 — списки полей, их добавляет настройка Bitrix24 (scripts/b24setup). Здесь — для портала, прогрева и отчётов.')}</div>
      </div>
    </>
  )
}
