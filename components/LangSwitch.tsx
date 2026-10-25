'use client'
import { useTransition } from 'react'
import { setLang } from '@/lib/actions'
import type { Lang } from '@/lib/i18n'

export function LangSwitch({ lang, order = ['ru', 'en', 'de', 'he'], light }: { lang: Lang; order?: Lang[]; light?: boolean }) {
  const [, start] = useTransition()
  return (
    <div className={'langs' + (light ? ' langs--light' : '')}>
      {order.map((l) => <button key={l} className={l === lang ? 'on' : ''} onClick={() => start(() => setLang(l))}>{l.toUpperCase()}</button>)}
    </div>
  )
}
