import { cookies } from 'next/headers'
import { t, isRtl, type Lang } from '@/lib/i18n'
import { LangSwitch } from '@/components/LangSwitch'

// Страницы без входа (вход, «Забыли пароль?», задание пароля): бренд слева, форма справа
export const authLang = (q?: string): Lang => ((['ru', 'en', 'de', 'he'].includes(q || '') ? q : cookies().get('ge_lang')?.value || 'ru') as Lang)
export function AuthLayout({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const T = (s: string) => t(lang, s)
  return (
    <div className="auth" dir={isRtl(lang) ? 'rtl' : 'ltr'}>
      <div className="auth__brand">
        <img src="/brand/wordmark-white.svg" alt="GetsEstate" style={{ height: 28 }} />
        <div className="label" style={{ color: 'var(--mist-2)', marginTop: 10 }}>{T('Партнёрский портал')}</div>
        <h2>{T('Каталог, брони и комиссия по Sea Breeze — в одном месте')}</h2>
        <div className="stack mt24" style={{ gap: 10 }}>
          {['Свободные квартиры и цены застройщиков', 'Закрепление клиента с первой регистрации', 'Бронь онлайн и подборки на языке клиента', 'Комиссия по каждой сделке — прозрачно'].map((x) => <div key={x}>— {T(x)}</div>)}
        </div>
        {/* Подпись стенда — только там, где задана STAND_LABEL (на бою её нет) */}
        {process.env.STAND_LABEL && <div className="small" style={{ marginTop: 40, color: 'var(--mist-2)' }}>{T(process.env.STAND_LABEL)}</div>}
      </div>
      <div className="auth__form">
        <div className="between"><span /><LangSwitch light lang={lang} /></div>
        {children}
      </div>
    </div>
  )
}
