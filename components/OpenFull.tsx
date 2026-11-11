'use client'
import { useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { handoffUrl } from '@/lib/handoff'

// 346: «Открыть на весь экран» из фрейма Bitrix24 — тот же раздел в новой вкладке, без повторного входа
export function OpenFull({ label }: { label: string }) {
  const path = usePathname() || '/', sp = useSearchParams()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    const w = window.open('about:blank', '_blank')
    const url = await handoffUrl(path + (sp?.toString() ? '?' + sp.toString() : ''))
    setBusy(false)
    if (url && w) w.location.href = url; else if (url) window.open(url, '_blank'); else w?.close()
  }
  return <button type="button" className="embed-full" onClick={go} disabled={busy} title={label}>{label} ↗</button>
}
