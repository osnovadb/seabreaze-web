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
  // страница подборки — на языке клиента, а не того, кто её открыл
  const selLang = path.startsWith('/s/') ? (await one<{ lang: string }>('select lang from portal.selections where token = $1', [path.slice(3).split('/')[0]]))?.lang : null
  const lang = (selLang as Lang | null) || ctx?.lang || (isLang(lc) ? lc : null) || 'ru'
  return (
    <html lang={lang} dir={isRtl(lang) ? 'rtl' : 'ltr'} className={`${serif.variable} ${sans.variable} ${hebrew.variable}`}>
      <body>{children}<TableCards /></body>
    </html>
  )
}
