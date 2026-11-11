'use client'
import { useState } from 'react'

// Л8 (ревью 10.11): вместо адреса ссылки на экране — кнопка «Скопировать ссылку»
export function CopyLink({ url, label, done }: { url: string; label: string; done: string }) {
  const [ok, setOk] = useState(false)
  return <button type="button" className="btn btn--sm" onClick={() => { navigator.clipboard?.writeText(url).then(() => { setOk(true); setTimeout(() => setOk(false), 2000) }) }}>{ok ? done : label}</button>
}
