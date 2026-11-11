import './globals.css'
import { Source_Serif_4, IBM_Plex_Sans, IBM_Plex_Sans_Hebrew } from 'next/font/google'
import { getCtx } from '@/lib/auth'
import { isRtl, isLang, type Lang } from '@/lib/i18n'
import { cookies, headers } from 'next/headers'
import { one } from '@/lib/db'
import { TableCards } from '@/components/TableCards'

const serif = Source_Serif_4({ subsets: ['latin', 'cyrillic'], weight: ['500'], variable: '--font-serif' })
const sans = IBM_Plex_Sans({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })
const hebrew = IBM_Plex_Sans_Hebrew({ subsets: ['hebrew'], weight: ['400', '500', '600', '700'], variable: '--font-hebrew' })

export const metadata = { title: 'GetsEstate · Portal', robots: { index: false, follow: false }, icons: { icon: '/brand/favicon.svg' } }

export default async function Root({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const lc = (await cookies()).get('ge_lang')?.value
  const path = (await headers()).get('x-path') || ''
  const ql = (await headers()).get('x-lang') || ''
  // страница подборки — на языке клиента, а не того, кто её открыл; О4: так же согласие, ссылка партнёра, политика и заявка
  const pageLang = await publicLang(path, ql, lc)
  const lang = (pageLang as Lang | null) || ctx?.lang || (isLang(lc) ? lc : null) || 'ru'
  return (
    <html lang={lang} dir={isRtl(lang) ? 'rtl' : 'ltr'} className={`${serif.variable} ${sans.variable} ${hebrew.variable}`}>
      <body>{children}<TableCards /></body>
    </html>
  )
}

// Те же правила, что у самих страниц (app/c, app/r, app/legal, app/apply) — чтобы <html lang dir> совпадал с текстом
async function publicLang(path: string, ql: string, lc: string | undefined): Promise<string | null> {
  const four = ['ru', 'en', 'de', 'he']
  const seg = path.split('/')[2] || ''
  if (path.startsWith('/s/')) return (await one<{ lang: string }>('select lang from portal.selections where token = $1', [seg]))?.lang || null
  if (path.startsWith('/c/')) {
    if (four.includes(ql)) return ql
    const l = (await one<{ language: string | null }>('select language from portal.clients where consent_token = $1', [seg]))?.language || ''
    return four.includes(l) ? l : 'en'
  }
  if (path.startsWith('/r/')) {
    const l = (await one<{ lang: string }>('select lang from portal.partner_links where code = $1', [seg]))?.lang || ''
    return ['de', 'en', 'ru', 'he'].includes(l) ? l : 'de'
  }
  if (path.startsWith('/legal')) { const c = ql || lc || 'en'; return ['ru', 'en', 'de'].includes(c) ? c : 'en' }
  if (path.startsWith('/apply')) return four.includes(ql) ? ql : isLang(lc) ? lc : 'de'
  return null
}
