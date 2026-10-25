import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { SignJWT, jwtVerify } from 'jose'
import { one } from './db'
import type { Role } from './perm'
import type { Lang } from './i18n'

const KEY = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-secret')
const COOKIE = 'ge_s'
const SHOW = 'ge_show'

export type User = {
  id: string; email: string; name: string; role: Role; market: string | null; agency_id: string | null
  curator_id: string | null; locale: Lang; active: boolean
}
export type Ctx = { user: User; real: User; impersonating: boolean; lang: Lang; show: null | { clientId: string | null; lang: Lang } }

// ver — версия сессий пользователя: «Завершить все сеансы» в админке увеличивает её, и старые cookie перестают действовать
export async function signSession(uid: string, as?: string) {
  const ver = (await one<{ session_ver: number }>('select session_ver from portal.users where id = $1', [uid]))?.session_ver ?? 0
  const token = await new SignJWT({ uid, as: as || null, ver }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('14d').sign(KEY())
  cookies().set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 14 * 86400 })
}
export function clearSession() {
  cookies().delete(COOKIE)
  cookies().delete(SHOW)
}

async function readSession(): Promise<{ uid: string; as: string | null; ver: number } | null> {
  const c = cookies().get(COOKIE)?.value
  if (!c) return null
  try {
    const { payload } = await jwtVerify(c, KEY())
    return { uid: String(payload.uid), as: (payload.as as string) || null, ver: Number(payload.ver ?? 0) }
  } catch {
    return null
  }
}

const userById = (id: string) =>
  one<User & { session_ver: number }>('select id, email, name, role, market, agency_id, curator_id, locale, active, session_ver from portal.users where id = $1 and active', [id])

export async function getCtx(): Promise<Ctx | null> {
  const s = await readSession()
  if (!s) return null
  const real = await userById(s.uid)
  if (!real || real.session_ver !== s.ver) return null
  const user = (s.as && real.role === 'owner' ? await userById(s.as) : null) || real
  const lc = cookies().get('ge_lang')?.value as Lang | undefined
  const lang: Lang = lc && ['ru', 'en', 'de', 'he'].includes(lc) ? lc : user.locale
  let show: Ctx['show'] = null
  const sc = cookies().get(SHOW)?.value
  if (sc) {
    try {
      const { payload } = await jwtVerify(sc, KEY())
      show = { clientId: (payload.client as string) || null, lang: (payload.lang as Lang) || lang }
    } catch { /* ignore */ }
  }
  return { user, real, impersonating: user.id !== real.id, lang: show ? show.lang : lang, show }
}

export async function requireCtx(): Promise<Ctx> {
  const c = await getCtx()
  if (!c) redirect('/login')
  return c
}

export async function setShow(clientId: string | null, lang: Lang) {
  const token = await new SignJWT({ client: clientId, lang }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('4h').sign(KEY())
  cookies().set(SHOW, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 4 * 3600 })
}
export function clearShow() { cookies().delete(SHOW) }
