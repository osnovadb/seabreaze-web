'use client'
import { InviteLink } from '@/components/InviteLink'
import { useFormStatus } from 'react-dom'
import { useActionState } from 'react'
import { updateUser, resetPassword, resetPin } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'
import { ROLE_NAMES, type Role } from '@/lib/perm'

type U = { id: string; name: string; email: string; role: Role; market: string | null; agency_id: string | null; curator_id: string | null; locale: string; license_note: string | null; contract_signed_at: string | null; leads_partners?: boolean; languages?: string[]; b24_user_id?: string | null }
function Btn({ label, primary }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus()
  return <button className={'btn' + (primary ? ' btn--p' : '')} disabled={pending}>{label}</button>
}

export function EditUser({ lang, u, owner, agencies, curators }: { lang: Lang; u: U; owner: boolean; agencies: { id: string; name: string }[]; curators: { id: string; name: string }[] }) {
  const T = (s: string) => t(lang, s)
  const [st, act] = useActionState(updateUser, null)
  const ext = u.role === 'agent' || u.role === 'agency_head'
  return (
    <form action={act} className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Данные и права')}</div>
      {st?.error && <div className="err">{T(st.error)}</div>}
      {st?.ok && <div className="okbox">{T('Сохранено')}</div>}
      <input type="hidden" name="id" value={u.id} />
      <div className="grid g2">
        <label className="field"><span>{T('Имя')}</span><input className="in" name="name" defaultValue={u.name} required /></label>
        <label className="field"><span>E-mail</span><input className="in" name="email" type="email" defaultValue={u.email} required /></label>
        <label className="field"><span>{T('Роль')}</span><select key={`role:${String(u.role)}`} className="in" name="role" defaultValue={u.role} disabled={!owner}>{Object.entries(ROLE_NAMES).map(([k, v]) => <option key={k} value={k}>{T(v)}</option>)}</select></label>
        <label className="field"><span>{T('Рынок')}</span><select key={`market:${String(u.market || '')}`} className="in" name="market" defaultValue={u.market || ''} disabled={!owner}><option value="DE">DE</option><option value="IL">IL</option><option value="GLOBAL">GLOBAL</option></select></label>
        <label className="field"><span>{T('Агентство (для агентов)')}</span><select key={`agency:${String(u.agency_id || '')}`} className="in" name="agency" defaultValue={u.agency_id || ''}><option value="">—</option>{agencies.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="field"><span>{T('Куратор')}</span><select key={`curator:${String(u.curator_id || '')}`} className="in" name="curator" defaultValue={u.curator_id || ''}><option value="">—</option>{curators.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        {/* 374/280: куратор партнёров — только с этой отметкой; сейлзу не ставится */}
        {owner && !['agent', 'agency_head', 'referrer', 'seller'].includes(u.role) && <label className="check" style={{ alignSelf: 'end' }}><input type="hidden" name="leads_partners_form" value="1" /><input type="checkbox" name="leads_partners" defaultChecked={!!u.leads_partners} /> {T('Ведёт партнёров (может быть куратором)')}</label>}
        <label className="field"><span>{T('Язык')}</span><select key={`locale:${String(u.locale)}`} className="in" name="locale" defaultValue={u.locale}>{['ru', 'en', 'de', 'he'].map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}</select></label>
        {ext && <label className="field"><span>{T('Договор подписан')}</span><input className="in" type="date" name="contract" defaultValue={u.contract_signed_at?.slice(0, 10) || ''} /></label>}
      </div>
      {!ext && <label className="field"><span>{T('Языки (для распределения лидов): RU, EN, DE, HE, AZ')}</span><input className="in" name="languages" defaultValue={(u.languages || []).join(', ')} placeholder="RU, DE" /></label>}
      {!ext && <div className="tiny muted">{T('Сотрудник Bitrix24')}: {u.b24_user_id ? '№ ' + u.b24_user_id : T('не связан — свяжется по e-mail при обмене')}</div>}
      {ext && <label className="field"><span>{T('Лицензия маклера')}</span><input className="in" name="license" defaultValue={u.license_note || ''} /></label>}
      {!owner && <div className="tiny muted">{T('Роль и рынок меняет владелец.')}</div>}
      <div><Btn label={T('Сохранить')} primary /></div>
    </form>
  )
}

export function Secrets({ lang, id }: { lang: Lang; id: string }) {
  const T = (s: string) => t(lang, s)
  const [pw, actPw] = useActionState(resetPassword, null)
  const [pin, actPin] = useActionState(resetPin, null)
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="h3" style={{ margin: 0 }}>{T('Пароль и PIN')}</div>
      <form action={actPw} className="row"><input type="hidden" name="id" value={id} /><Btn label={T('Ссылка на новый пароль')} /></form>
      {pw?.link && <InviteLink lang={lang} link={pw.link} mailed={pw.mailed} title={T('Ссылка готова: по ней пользователь задаст новый пароль. Старый пароль действует, пока новый не задан.')} />}
      {pw?.error && <div className="err">{T(pw.error)}</div>}
      <form action={actPin} className="row"><input type="hidden" name="id" value={id} /><Btn label={T('Новый PIN режима показа')} /></form>
      {pin?.pin && <div className="okbox">{T('Новый PIN')}: <b>{pin.pin}</b></div>}
      {pin?.error && <div className="err">{T(pin.error)}</div>}
      <div className="tiny muted">{T('Новый пароль, заданный по ссылке, завершает все сеансы пользователя. Свой пароль и PIN пользователь меняет в профиле.')}</div>
    </div>
  )
}
