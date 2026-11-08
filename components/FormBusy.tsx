'use client'
import { useEffect } from 'react'

// QA 09.11: у большинства форм на серверных действиях не было признака отправки — кнопка жалась, а ответ приходил через 1–3 с,
// люди жали ещё раз или решали, что не сработало. Глобально: нажатая кнопка гаснет до первого обновления страницы (макс. 15 с).
export function FormBusy() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const clear = () => { document.querySelectorAll('.is-busy').forEach((b) => b.classList.remove('is-busy')); if (timer) clearTimeout(timer); timer = null }
    const mo = new MutationObserver(() => { if (document.querySelector('.is-busy')) setTimeout(clear, 150) })
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement
      if (form.method === 'get' && !form.getAttribute('action')?.startsWith('javascript')) return // фильтры и поиск — обычная навигация
      const btn = (e.submitter as HTMLElement | null) || form.querySelector('button:not([type=button])')
      if (!btn) return
      // после отправки: иначе браузер не включит значение кнопки в форму
      setTimeout(() => { btn.classList.add('is-busy'); if (timer) clearTimeout(timer); timer = setTimeout(clear, 15000) }, 0)
    }
    document.addEventListener('submit', onSubmit)
    return () => { document.removeEventListener('submit', onSubmit); mo.disconnect(); clear() }
  }, [])
  return null
}
