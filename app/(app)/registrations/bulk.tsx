'use client'
import { useState, useTransition } from 'react'
import { sendRegistrations } from '@/lib/regActions'
import { t, type Lang } from '@/lib/i18n'

// Выбор строк (галочки name="rid") → файл застройщику / полный список / «Отметить отправленными».
// Ничего не выбрано — выгружается весь отфильтрованный список (query — текущие фильтры экрана)
export function RegBulk({ lang, query, edit, canSend, total = 0 }: { lang: Lang; query: string; edit: boolean; canSend: boolean; total?: number }) {
  const T = (s: string, v?: Record<string, string | number>) => t(lang, s, v)
  const [fl, setFl] = useState('ru')
  const [pending, start] = useTransition()
  const picked = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[name=rid]:checked')).map((x) => x.value)
  const dl = (kind: string) => {
    const ids = picked()
    // Б3: действие над всем списком — с подтверждением и числом строк
    if (!ids.length && !window.confirm(T('Ничего не отмечено — выгрузить весь список по фильтру: {n} строк?', { n: total }))) return
    window.location.href = `/api/registrations/export?${query}${query ? '&' : ''}kind=${kind}&lang=${fl}${ids.length ? '&ids=' + ids.join(',') : ''}`
  }
  const send = () => {
    const ids = picked()
    if (!ids.length) return
    const f = new FormData(); ids.forEach((x) => f.append('id', x))
    start(() => sendRegistrations(f))
  }
  return (
    <div className="card card--tight row mt16" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="small muted">{T('Отмеченные галочкой, а если ничего не отмечено — весь список по фильтру (строки без согласия клиента в файл застройщику не попадают):')}</span>
      <button type="button" className="btn btn--sm btn--p" onClick={() => dl('dev')}>{T('Файл застройщику (xlsx)')}</button>
      <span className="small muted">{T('Язык файла')}:</span>{/* М8: у списка языка не было подписи */}
      <select className="in in--sm" value={fl} onChange={(e) => setFl(e.target.value)} title={T('Язык файла')} style={{ width: 90 }}><option value="ru">RU</option><option value="en">EN</option><option value="az">AZ</option></select>
      <button type="button" className="btn btn--sm" onClick={() => dl('full')}>{T('Полный список (xlsx)')}</button>
      {edit && canSend && <button type="button" className="btn btn--sm" disabled={pending} onClick={send}>{T(pending ? 'Отмечаем…' : 'Отметить отправленными')}</button>}
      <span className="tiny muted" style={{ flexBasis: '100%' }}>{T('В файле застройщику — только имя, контакты, страна, проект и наш номер; о партнёрах и внутренних сроках — ничего. По листу на проект. Каждая выгрузка записывается в журнал.')}</span>
    </div>
  )
}

// «Выбрать все» в шапке таблицы
export function CheckAll() {
  return <input type="checkbox" aria-label="all" onChange={(e) => document.querySelectorAll<HTMLInputElement>('input[name=rid]:not(:disabled)').forEach((x) => { x.checked = e.target.checked })} />
}
