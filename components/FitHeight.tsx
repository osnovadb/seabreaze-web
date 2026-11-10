'use client'
import { useEffect } from 'react'

// QA 10.11: боковая панель шахматки — не длиннее видимой части экрана (и до прокрутки, и когда прилипла к верху); дальше — своя прокрутка
export function FitHeight({ selector }: { selector: string }) {
  useEffect(() => {
    const fit = () => {
      const el = document.querySelector<HTMLElement>(selector)
      if (!el) return
      const top = Math.max(16, el.getBoundingClientRect().top)
      el.style.maxHeight = `${Math.max(320, window.innerHeight - top - 16)}px`
    }
    fit()
    window.addEventListener('scroll', fit, { passive: true }); window.addEventListener('resize', fit)
    return () => { window.removeEventListener('scroll', fit); window.removeEventListener('resize', fit) }
  }, [selector])
  return null
}
