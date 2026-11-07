'use client'
import { useFormState, useFormStatus } from 'react-dom'
import { linkLead } from '@/lib/linkActions'
import { t, type Lang } from '@/lib/i18n'

function Submit({ lang }: { lang: Lang }) {
  const { pending } = useFormStatus()
  return <button className="btn btn--p" disabled={pending}>{t(lang, 'Отправить')}</button>
}
// Две галочки согласия под брендом агентства (§15): обязательная — данные и передача застройщикам; необязательная — реклама и рассылки
export function LinkLeadForm({ lang, code, projects, project, brand }: { lang: Lang; code: string; projects: string[]; project?: string; brand: string }) {
  const [st, act] = useFormState(linkLead, null)
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  if (st?.ok) return <div className="okbox">{T('Спасибо! {b} свяжется с вами в ближайшее время.', { b: brand })}</div>
  return (
    <form action={act} className="stack" style={{ gap: 10 }}>
      {st?.error && <div className="err">{T(st.error)}</div>}
      <input type="hidden" name="code" value={code} /><input type="hidden" name="lang" value={lang} />
      <input name="website" tabIndex={-1} autoComplete="off" style={{ position: 'absolute', left: -9999 }} aria-hidden="true" />
      <label className="field"><span>{T('Имя и фамилия')} *</span><input className="in" name="name" required autoComplete="name" /></label>
      <div className="grid g2">
        <label className="field"><span>{T('Телефон')}</span><input className="in" name="phone" type="tel" autoComplete="tel" /></label>
        <label className="field"><span>E-mail</span><input className="in" name="email" type="email" autoComplete="email" /></label>
      </div>
      <label className="field"><span>{T('Страна проживания')}</span><input className="in" name="country" autoComplete="country-name" /></label>
      {projects.length > 1 && <label className="field"><span>{T('Проект')}</span><select className="in" name="project" defaultValue={project || ''}><option value="">{T('Помогите выбрать')}</option>{projects.map((p) => <option key={p}>{p}</option>)}</select></label>}
      {projects.length === 1 && <input type="hidden" name="project" value={projects[0]} />}
      <label className="field"><span>{T('Комментарий')}</span><textarea className="in" name="comment" rows={2} /></label>
      <label className="check small"><input type="checkbox" name="consent" required /> <span>{T('Согласен на обработку моих данных и их передачу застройщикам для подбора и регистрации, включая застройщиков, с которыми работа начнётся позже')} *</span></label>
      <label className="check small"><input type="checkbox" name="marketing" /> <span>{T('Согласен получать рекламу и рассылки (необязательно)')}</span></label>
      <Submit lang={lang} />
    </form>
  )
}
