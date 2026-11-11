'use client'
import { useEffect } from 'react'

// Б9 (ревью 10.11): клиент вкладки Bitrix24 живёт в адресе (?cl=). Внутри вкладки переход по ссылке или GET-форме сохраняет его;
// разделы левого меню Bitrix24 открываются без cl — без клиента. Ссылки с data-nocl (например «Выйти из клиента») — без клиента.
export function EmbedCl({ cl }: { cl: string | null }) {
  useEffect(() => {
    if (!cl) return
    const keep = (u: URL) => u.origin === location.origin && !u.pathname.startsWith('/api/') && !u.searchParams.has('cl') && !/^\/b24\/units\/[0-9a-f-]{36}/.test(u.pathname)
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.dataset.nocl || a.target === '_blank' || a.hasAttribute('download')) return
      const u = new URL(a.getAttribute('href') || '', location.href)
      if (!keep(u)) return
      u.searchParams.set('cl', cl)
      e.preventDefault(); e.stopPropagation()
      location.assign(u.toString())
    }
    const onSubmit = (e: SubmitEvent) => {
      const f = e.target as HTMLFormElement
      if ((f.method || 'get').toLowerCase() !== 'get' || f.querySelector('input[name=cl]')) return
      const u = new URL(f.getAttribute('action') || location.href, location.href)
      if (!keep(u)) return
      const i = document.createElement('input'); i.type = 'hidden'; i.name = 'cl'; i.value = cl; f.appendChild(i)
    }
    document.addEventListener('click', onClick, true)
    document.addEventListener('submit', onSubmit, true)
    return () => { document.removeEventListener('click', onClick, true); document.removeEventListener('submit', onSubmit, true) }
  }, [cl])
  return null
}
