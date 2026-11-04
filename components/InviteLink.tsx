'use client'
import { useState } from 'react'
import { t, type Lang } from '@/lib/i18n'

// Ссылка-приглашение или сброса пароля: показывается один раз, копируется в мессенджер; при подключённой почте ещё и уходит письмом
export function InviteLink({ lang, link, mailed, title }: { lang: Lang; link: string; mailed?: boolean; title: string }) {
  const T = (s: string) => t(lang, s)
  const [done, setDone] = useState(false)
  return (
    <div className="okbox small stack" style={{ gap: 6 }}>
      <div>{title}</div>
      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <input className="in" readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, fontSize: 12 }} />
        <button type="button" className="btn btn--sm" onClick={() => navigator.clipboard?.writeText(link).then(() => setDone(true))}>{done ? T('Скопировано') : T('Копировать')}</button>
      </div>
      <div className="tiny">{mailed ? T('Письмо со ссылкой отправлено на e-mail пользователя.') : T('Почта пока не подключена — отправьте ссылку сами (мессенджер, письмо). Ссылка одноразовая.')}</div>
    </div>
  )
}
