// Тексты политики конфиденциальности и согласия клиента. Черновик: юрлицо, адрес и надзорный орган
// добавляются после решения по структуре (поля в квадратных скобках). Перед публикацией — проверка юристом рынка.
type Doc = { title: string; updated: string; sections: [string, string][] }
export type LegalLang = 'ru' | 'en' | 'de'

const CTRL = { ru: '[Юридическое лицо GetsEstate, адрес, регистрационный номер]', en: '[GetsEstate legal entity, address, registration number]', de: '[GetsEstate Rechtsträger, Anschrift, Registernummer]' }

export const PRIVACY: Record<LegalLang, Doc> = {
  ru: {
    title: 'Политика конфиденциальности партнёрского портала GetsEstate', updated: 'Черновик от 24.10.2026',
    sections: [
      ['1. Кто отвечает за данные', `Оператор (контролёр) персональных данных — ${CTRL.ru}, далее «GetsEstate». Вопросы по данным: [e-mail для запросов по данным].`],
      ['2. Чьи данные мы обрабатываем', 'Партнёров (агентов и агентств): имя, компания, контакты, страна, языки, сведения о разрешении на маклерскую деятельность, данные договора и выплат. Клиентов, которых регистрируют партнёры или команда GetsEstate: имя, телефон, e-mail, страна, язык, предпочтения по покупке (цель, бюджет, сроки, способ оплаты), история общения, данные о бронях и сделках, документы для проверки клиента (KYC). Пользователей портала: журнал действий, IP-адрес и технические данные сессии.'],
      ['3. Зачем', 'Подбор недвижимости и сопровождение сделки; закрепление клиента за партнёром и разрешение споров о том, чей клиент; регистрация клиента и бронирование у застройщика; проверка клиента по требованиям о противодействии отмыванию денег; расчёт и выплата вознаграждения партнёрам; безопасность портала.'],
      ['4. Правовые основания', 'Исполнение договора или подготовка к нему (ст. 6(1)(b) GDPR); согласие клиента — для передачи данных застройщику (ст. 6(1)(a) и ст. 49(1)(a) GDPR); юридические обязанности — учёт, налоги, проверка клиента (ст. 6(1)(c)); законный интерес — журнал действий для разрешения споров и безопасность (ст. 6(1)(f)).'],
      ['5. Кому передаём', 'Застройщику выбранного проекта в Азербайджане — минимум, нужный для регистрации клиента, брони и договора (имя и телефон или e-mail; для договора — данные, которые требует застройщик). Азербайджан не входит в ЕС/ЕЭЗ и не имеет решения ЕС об адекватности защиты, поэтому передача происходит на основании явного согласия клиента. Компаниям группы GetsEstate, которые ведут сделку (офисы на рынках и в Баку). Поставщикам ИТ-услуг: серверы портала находятся в ЕС (Нидерланды).'],
      ['6. Сколько храним', 'Данные клиента — на срок работы с ним и 3 года после окончания закрепления; данные сделок и выплат — сроки налогового и бухгалтерского учёта (до 10 лет); документы проверки клиента — 5 лет после окончания отношений; журнал действий — 3 года.'],
      ['7. Ваши права', 'Получить копию данных, исправить, удалить, ограничить обработку, получить данные в машиночитаемом виде, возразить против обработки, отозвать согласие в любой момент (это не влияет на обработку до отзыва), подать жалобу в надзорный орган по защите данных [орган по месту нахождения GetsEstate]. Ответ на запрос — в течение 30 дней.'],
      ['8. Безопасность', 'Доступ по ролям: партнёр видит только своих клиентов, контакты клиентов не попадают в выгрузки без права на это, все действия пишутся в журнал. Передача данных — по шифрованному соединению.'],
      ['9. Cookie', 'Портал использует только необходимые cookie: сессия входа, выбранный язык и режим показа клиенту. Аналитических и рекламных cookie нет.'],
    ],
  },
  en: {
    title: 'GetsEstate partner portal — privacy policy', updated: 'Draft, 24 Oct 2026',
    sections: [
      ['1. Controller', `The controller of personal data is ${CTRL.en} ("GetsEstate"). Data requests: [data request e-mail].`],
      ['2. Whose data we process', 'Partners (agents and agencies): name, company, contact details, country, languages, broker licence details, contract and payout data. Clients registered by partners or GetsEstate staff: name, phone, e-mail, country, language, purchase preferences (purpose, budget, timing, payment), communication history, bookings and deals, client due diligence (KYC) documents. Portal users: activity log, IP address and session data.'],
      ['3. Purposes', 'Property selection and transaction support; assigning a client to a partner and resolving disputes over client ownership; registering the client and booking with the developer; anti-money-laundering checks; calculating and paying partner commissions; portal security.'],
      ['4. Legal bases', 'Performance of a contract or steps prior to it (Art. 6(1)(b) GDPR); the client’s explicit consent for transfer to the developer (Art. 6(1)(a) and Art. 49(1)(a) GDPR); legal obligations — accounting, tax, due diligence (Art. 6(1)(c)); legitimate interests — activity log for dispute resolution and security (Art. 6(1)(f)).'],
      ['5. Recipients', 'The developer of the selected project in Azerbaijan — only what is needed to register the client, book and sign (name and phone or e-mail; for the contract, the data the developer requires). Azerbaijan is outside the EU/EEA without an adequacy decision, so the transfer relies on the client’s explicit consent. GetsEstate group companies handling the deal (market offices and Baku). IT service providers; the portal servers are located in the EU (Netherlands).'],
      ['6. Retention', 'Client data — while we work with the client and 3 years after the assignment ends; deal and payout data — statutory accounting and tax periods (up to 10 years); KYC documents — 5 years after the relationship ends; activity log — 3 years.'],
      ['7. Your rights', 'Access, rectification, erasure, restriction, data portability, objection, and withdrawal of consent at any time (without affecting prior processing); the right to lodge a complaint with a supervisory authority [authority competent for GetsEstate]. We reply within 30 days.'],
      ['8. Security', 'Role-based access: a partner sees only their own clients; client contacts are excluded from exports without the corresponding right; every action is logged. Data is transferred over encrypted connections.'],
      ['9. Cookies', 'Only strictly necessary cookies: login session, selected language and client presentation mode. No analytics or advertising cookies.'],
    ],
  },
  de: {
    title: 'Datenschutzerklärung des GetsEstate-Partnerportals', updated: 'Entwurf vom 24.10.2026',
    sections: [
      ['1. Verantwortlicher', `Verantwortlich für die Verarbeitung personenbezogener Daten ist ${CTRL.de} („GetsEstate“). Anfragen zum Datenschutz: [E-Mail für Datenschutzanfragen].`],
      ['2. Wessen Daten wir verarbeiten', 'Partner (Makler und Agenturen): Name, Firma, Kontaktdaten, Land, Sprachen, Angaben zur Erlaubnis nach §34c GewO, Vertrags- und Auszahlungsdaten. Kunden, die von Partnern oder GetsEstate erfasst werden: Name, Telefon, E-Mail, Land, Sprache, Kaufwünsche (Zweck, Budget, Zeitrahmen, Zahlungsweise), Kommunikationsverlauf, Reservierungen und Abschlüsse, Unterlagen zur Kundenprüfung (KYC). Nutzer des Portals: Aktivitätsprotokoll, IP-Adresse und Sitzungsdaten.'],
      ['3. Zwecke', 'Immobilienauswahl und Begleitung des Kaufs; Zuordnung des Kunden zum Partner und Klärung von Streitigkeiten über die Kundenzuordnung; Registrierung und Reservierung beim Bauträger; Prüfungen nach Geldwäscherecht; Berechnung und Auszahlung von Provisionen; Sicherheit des Portals.'],
      ['4. Rechtsgrundlagen', 'Vertragserfüllung bzw. vorvertragliche Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO); ausdrückliche Einwilligung des Kunden für die Übermittlung an den Bauträger (Art. 6 Abs. 1 lit. a, Art. 49 Abs. 1 lit. a DSGVO); rechtliche Pflichten — Buchhaltung, Steuern, Kundenprüfung (Art. 6 Abs. 1 lit. c); berechtigte Interessen — Aktivitätsprotokoll zur Streitklärung und Sicherheit (Art. 6 Abs. 1 lit. f).'],
      ['5. Empfänger', 'Der Bauträger des gewählten Projekts in Aserbaidschan — nur die für Registrierung, Reservierung und Vertrag erforderlichen Daten (Name und Telefon oder E-Mail; für den Vertrag die vom Bauträger verlangten Angaben). Aserbaidschan liegt außerhalb der EU/des EWR, ein Angemessenheitsbeschluss besteht nicht; die Übermittlung erfolgt auf Grundlage der ausdrücklichen Einwilligung des Kunden. Gesellschaften der GetsEstate-Gruppe, die den Kauf begleiten (Büros in den Märkten und in Baku). IT-Dienstleister; die Server des Portals stehen in der EU (Niederlande).'],
      ['6. Speicherdauer', 'Kundendaten — für die Dauer der Betreuung und 3 Jahre nach Ende der Zuordnung; Abschluss- und Auszahlungsdaten — gesetzliche Aufbewahrungsfristen (bis zu 10 Jahre); KYC-Unterlagen — 5 Jahre nach Ende der Geschäftsbeziehung; Aktivitätsprotokoll — 3 Jahre.'],
      ['7. Ihre Rechte', 'Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch sowie Widerruf einer Einwilligung jederzeit mit Wirkung für die Zukunft; Beschwerderecht bei einer Aufsichtsbehörde [zuständige Behörde]. Wir antworten innerhalb von 30 Tagen.'],
      ['8. Sicherheit', 'Rollenbasierter Zugriff: Ein Partner sieht nur seine eigenen Kunden; Kundenkontakte sind ohne entsprechendes Recht von Exporten ausgeschlossen; jede Aktion wird protokolliert. Übertragung nur verschlüsselt.'],
      ['9. Cookies', 'Nur technisch notwendige Cookies: Anmeldesitzung, gewählte Sprache und Präsentationsmodus. Keine Analyse- oder Werbe-Cookies.'],
    ],
  },
}

export const CONSENT: Record<LegalLang, Doc> = {
  ru: {
    title: 'Согласие клиента на обработку и передачу данных', updated: 'Черновик от 24.10.2026',
    sections: [
      ['Текст согласия', `Я согласен(на), что ${CTRL.ru} и партнёр, который меня консультирует, обрабатывают мои данные (имя, контакты, страна, язык, пожелания по покупке, история общения) для подбора недвижимости и сопровождения покупки.`],
      ['Передача застройщику', 'Я согласен(на) на передачу моего имени и телефона или e-mail застройщику выбранного проекта в Азербайджане для регистрации меня как клиента, брони и подготовки договора. Мне известно, что Азербайджан находится вне ЕС/ЕЭЗ и уровень защиты данных там может отличаться.'],
      ['Отзыв', 'Согласие можно отозвать в любой момент, написав консультанту или на [e-mail для запросов по данным]. Отзыв не влияет на обработку до него. Подробнее — в политике конфиденциальности.'],
      ['Как фиксируется', 'Партнёр отмечает согласие в портале при регистрации клиента; дата согласия хранится в карточке клиента. Без отметки регистрация невозможна.'],
    ],
  },
  en: {
    title: 'Client consent to data processing and transfer', updated: 'Draft, 24 Oct 2026',
    sections: [
      ['Consent', `I agree that ${CTRL.en} and the partner advising me process my data (name, contact details, country, language, purchase preferences, communication history) to select property and support my purchase.`],
      ['Transfer to the developer', 'I agree that my name and phone number or e-mail are transferred to the developer of the selected project in Azerbaijan to register me as a client, make a booking and prepare the contract. I understand that Azerbaijan is outside the EU/EEA and data protection there may differ.'],
      ['Withdrawal', 'I can withdraw this consent at any time by contacting my advisor or [data request e-mail]. Withdrawal does not affect prior processing. See the privacy policy for details.'],
      ['How it is recorded', 'The partner records the consent in the portal when registering the client; the date is stored on the client card. Registration is impossible without it.'],
    ],
  },
  de: {
    title: 'Einwilligung des Kunden in Verarbeitung und Übermittlung', updated: 'Entwurf vom 24.10.2026',
    sections: [
      ['Einwilligung', `Ich willige ein, dass ${CTRL.de} und der mich beratende Partner meine Daten (Name, Kontaktdaten, Land, Sprache, Kaufwünsche, Kommunikationsverlauf) zur Immobilienauswahl und Begleitung des Kaufs verarbeiten.`],
      ['Übermittlung an den Bauträger', 'Ich willige ein, dass mein Name und meine Telefonnummer oder E-Mail-Adresse an den Bauträger des gewählten Projekts in Aserbaidschan übermittelt werden, um mich als Kunden zu registrieren, eine Reservierung vorzunehmen und den Vertrag vorzubereiten. Mir ist bekannt, dass Aserbaidschan außerhalb der EU/des EWR liegt und das Datenschutzniveau dort abweichen kann.'],
      ['Widerruf', 'Die Einwilligung kann ich jederzeit mit Wirkung für die Zukunft widerrufen — beim Berater oder unter [E-Mail für Datenschutzanfragen]. Einzelheiten in der Datenschutzerklärung.'],
      ['Dokumentation', 'Der Partner bestätigt die Einwilligung bei der Registrierung im Portal; das Datum wird in der Kundenkarte gespeichert. Ohne Bestätigung ist keine Registrierung möglich.'],
    ],
  },
}
