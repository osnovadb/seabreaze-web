import { notFound } from 'next/navigation'

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
// Карточки по [id]: не-UUID в адресе — 404, а не ошибка базы (invalid input syntax for type uuid → 500)
export function needUuid(s: string) { if (!isUuid(s)) notFound() }
