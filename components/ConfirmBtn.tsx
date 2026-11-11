'use client'
// Обход 11.11 (О8, О10, О24, О30, О32): необратимое действие — только после подтверждения
export function ConfirmBtn({ msg, className = 'btn btn--sm', children, name, value, disabled }: { msg: string; className?: string; children: React.ReactNode; name?: string; value?: string; disabled?: boolean }) {
  return <button className={className} name={name} value={value} disabled={disabled} onClick={(e) => { if (!window.confirm(msg)) e.preventDefault() }}>{children}</button>
}
