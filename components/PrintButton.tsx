'use client'
// PDF подборки: печать страницы браузером («Сохранить как PDF»), служебные элементы скрыты стилями печати
export function PrintButton({ label }: { label: string }) {
  return <button className="btn btn--sm noprint" onClick={() => window.print()}>{label}</button>
}
