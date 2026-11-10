'use client'
import { startTransition, useActionState, useEffect, useRef, useState } from 'react'
import { t, type Lang } from '@/lib/i18n'

type State = { ok?: boolean; error?: string; made?: number; warning?: string } | null | undefined
// Форма серверного действия с ответом «сохранено / ошибка» на месте — для админки объектов.
// QA 10.11: React 19 сам сбрасывает <form action={…}> после ответа — при ошибке пропадал выбор (квартал), списки откатывались.
// Отправляем через onSubmit (без автосброса): введённое остаётся; «добавить»-формы (reset) очищаем сами после успеха.
// Сообщение об ошибке/успехе прячем, как только пользователь начал править форму.
export function ActionForm({ action, lang, children, className, style, okText, reset }: {
  action: (s: any, f: FormData) => Promise<State>; lang: Lang; children: React.ReactNode; className?: string; style?: React.CSSProperties; okText?: string; reset?: boolean
}) {
  const [st, act] = useActionState(action, null)
  const [quiet, setQuiet] = useState(false)
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => { if (reset && st?.ok) ref.current?.reset() }, [st, reset])
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const sub = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null
    const fd = new FormData(e.currentTarget, sub && (sub.tagName === 'BUTTON' || sub.tagName === 'INPUT') ? sub : undefined)
    setQuiet(false)
    startTransition(() => act(fd))
  }
  const show = !quiet
  return (
    <form ref={ref} method="post" onSubmit={submit} onChange={() => setQuiet(true)} className={className} style={style}>
      {children}
      {show && st?.error && <div className="err tiny" style={{ gridColumn: '1 / -1' }}>{st.error}</div>}
      {show && st?.ok && <div className="tiny okc" style={{ gridColumn: '1 / -1' }}>{okText || t(lang, 'Сохранено')}{st.made != null ? ` · ${st.made}` : ''}</div>}
      {show && st?.warning && <div className="tiny warnc" style={{ gridColumn: '1 / -1' }}>{st.warning}</div>}
    </form>
  )
}
