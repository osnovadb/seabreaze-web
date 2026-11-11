'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// М3, М5 (ревью 10.11): внутри Bitrix24 окно приложения было фиксированной высоты с внутренней прокруткой, а заголовок — «Back office»
// для любого раздела. Подключаем JS SDK Bitrix24 (параметры фрейма он берёт из window.name, его выставляет сам Bitrix24 —
// после нашего 303-перехода имя окна сохраняется): заголовок — по разделу, высота — по содержимому.
// Вне Bitrix24 BX24.init не срабатывает — ничего не меняется.
declare global { interface Window { BX24?: { init: (cb: () => void) => void; setTitle: (t: string) => void; resizeWindow: (w: number, h: number) => void } } }
let ready: Promise<boolean> | null = null
function sdk(): Promise<boolean> {
  if (ready) return ready
  ready = new Promise((res) => {
    if (window.parent === window) return res(false)
    const s = document.createElement('script')
    s.src = 'https://api.bitrix24.com/api/v1/'
    s.onload = () => { try { let ok = false; window.BX24?.init(() => { ok = true; res(true) }); setTimeout(() => !ok && res(false), 4000) } catch { res(false) } }
    s.onerror = () => res(false)
    document.head.appendChild(s)
  })
  return ready
}

export function B24Frame({ titles }: { titles: [string, string][] }) {
  const path = usePathname()
  useEffect(() => {
    let off = () => {}
    sdk().then((ok) => {
      if (!ok || !window.BX24) return
      const best = titles.filter(([h]) => path === h || path.startsWith(h + '/')).sort((a, b) => b[0].length - a[0].length)[0]
      try { window.BX24.setTitle(best ? `GetsEstate · ${best[1]}` : 'GetsEstate') } catch {}
      let last = 0, t = 0
      const fit = () => {
        cancelAnimationFrame(t)
        t = requestAnimationFrame(() => {
          const h = Math.max(600, Math.ceil(document.documentElement.scrollHeight))
          if (Math.abs(h - last) < 8) return
          last = h
          try { window.BX24!.resizeWindow(document.documentElement.clientWidth, h) } catch {}
        })
      }
      fit()
      const ro = new ResizeObserver(fit)
      ro.observe(document.body)
      off = () => { ro.disconnect(); cancelAnimationFrame(t) }
    })
    return () => off()
  }, [path, titles])
  return null
}
