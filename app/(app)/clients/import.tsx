'use client'
import { useFormState } from 'react-dom'
import { importClients } from '@/lib/actions'
import { t, type Lang } from '@/lib/i18n'

// Импорт и выгрузка клиентов в xlsx (М13)
export function ImportExport({ lang }: { lang: Lang }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [st, act] = useFormState(importClients, null)
  return (
    <details className="card mt16">
      <summary className="small bronze" style={{ cursor: 'pointer' }}>{T('Импорт и выгрузка xlsx')}</summary>
      <div className="row mt8" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <a className="btn" href="/clients/export">{T('Выгрузить клиентов в xlsx')}</a>
        <form action={act} className="stack" style={{ gap: 6, flex: 1, minWidth: 280 }} encType="multipart/form-data">
          <input className="in" type="file" name="file" accept=".xlsx" required style={{ paddingTop: 6 }} />
          <div className="tiny muted">{T('Колонки: Имя, Телефон, E-mail, Страна, Язык, Источник, Цель, Бюджет, Согласие (да). Дубли по телефону и e-mail пропускаются.')}</div>
          <div><button className="btn btn--sm btn--p">{T('Загрузить клиентов')}</button></div>
          {st?.error && <div className="err tiny">{T(st.error)}</div>}
          {st?.ok && <div className="tiny okc">{T('Добавлено: {n}', { n: st.made ?? 0 })}{st.skipped?.length ? ' · ' + T('пропущено: {n}', { n: st.skipped.length }) : ''}</div>}
          {st?.skipped?.length ? <div className="tiny muted">{st.skipped.slice(0, 20).join('; ')}</div> : null}
        </form>
      </div>
    </details>
  )
}
