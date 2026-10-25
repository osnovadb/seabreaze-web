'use client'
import { useEffect, useRef } from 'react'
import { useFormState } from 'react-dom'
import { t, type Lang } from '@/lib/i18n'

type State = { ok?: boolean; error?: string; made?: number } | null | undefined
// Форма серверного действия с ответом «сохранено / ошибка» на месте — для админки объектов
export function ActionForm({ action, lang, children, className, style, okText, reset }: {
  action: (s: any, f: FormData) => Promise<State>; lang: Lang; children: React.ReactNode; className?: string; style?: React.CSSProperties; okText?: string; reset?: boolean
}) {
  const [st, act] = useFormState(action, null)
  const ref = useRef<HTMLFormElement>(null)
  // Формы «добавить» очищаем после успешного сохранения, чтобы следующая запись не унаследовала значения
  useEffect(() => { if (reset && st?.ok) ref.current?.reset() }, [st, reset])
  return (
    <form ref={ref} action={act} className={className} style={style} encType="multipart/form-data">
      {children}
      {st?.error && <div className="err tiny" style={{ gridColumn: '1 / -1' }}>{st.error}</div>}
      {st?.ok && <div className="tiny okc" style={{ gridColumn: '1 / -1' }}>{okText || t(lang, 'Сохранено')}{st.made != null ? ` · ${st.made}` : ''}</div>}
    </form>
  )
}
