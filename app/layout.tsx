import './globals.css'
import { Source_Serif_4, IBM_Plex_Sans, IBM_Plex_Sans_Hebrew } from 'next/font/google'
import { getCtx } from '@/lib/auth'
import { isRtl } from '@/lib/i18n'
import { cookies } from 'next/headers'

const serif = Source_Serif_4({ subsets: ['latin', 'cyrillic'], weight: ['500'], variable: '--font-serif' })
const sans = IBM_Plex_Sans({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--font-sans' })
const hebrew = IBM_Plex_Sans_Hebrew({ subsets: ['hebrew'], weight: ['400', '500', '600', '700'], variable: '--font-hebrew' })

export const metadata = { title: 'GetsEstate · Portal', robots: { index: false, follow: false }, icons: { icon: '/brand/favicon.svg' } }

export default async function Root({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx()
  const lc = cookies().get('ge_lang')?.value
  const lang = ctx?.lang || (lc as 'ru' | 'en' | 'de' | 'he') || 'ru'
  return (
    <html lang={lang} dir={isRtl(lang) ? 'rtl' : 'ltr'} className={`${serif.variable} ${sans.variable} ${hebrew.variable}`}>
      <body>{children}</body>
    </html>
  )
}
