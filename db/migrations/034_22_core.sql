-- 2.2 · Ядро (ТЗ 2.2, разделы 7, 10, 12): застройщики и их условия, регистрации у застройщиков с таймером молчания,
-- закрепление «чей клиент» по разделу 10, холд и очередь лимита броней, рынки и офисы, словари, роль рекомендателя.

-- Застройщик: всё, что задаёт договор (карточка условий, §7)
create table if not exists portal.developers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  reg_method            text not null default 'email' check (reg_method in ('crm','email','api','file')),
  reg_email             text,
  reg_response_days     int  not null default 3 check (reg_response_days between 0 and 60),   -- рабочих дней на ответ
  silence_rule          text not null default 'remind' check (silence_rule in ('confirm','remind')), -- 263
  silence_extra_days    int  not null default 0 check (silence_extra_days between 0 and 30),  -- «3 + 2 дня»
  protect_months        int  not null default 6 check (protect_months between 1 and 36),       -- защита регистрации
  protect_months_sub    int  check (protect_months_sub between 1 and 36),                     -- для клиентов саб-агентов, если иначе
  renew_remind_days     int  not null default 7,
  booking_days          int  not null default 14 check (booking_days between 1 and 90),
  booking_ext_days      int  not null default 14 check (booking_ext_days between 0 and 90),
  max_bookings_total    int  not null default 10 check (max_bookings_total between 1 and 1000), -- одновременных на всю GetsEstate
  booking_write_api     boolean not null default false,                                        -- запись броней в Profitbase (261)
  commission_pct        numeric(5,2),
  rates_by_market       jsonb not null default '{}',                                           -- {"DE":4,"IL":2.5}
  vat_mode              text not null default 'over' check (vat_mode in ('over','incl')),       -- комиссия сверх НДС / включая
  options_in_base       boolean not null default false,                                        -- 257
  pay_timing            text not null default 'after_first_payment',
  fx_rule               text,                                                                  -- «ЦБА на дату платежа»
  clawback_months       int  not null default 3,
  clawback_offset       text not null default 'any' check (clawback_offset in ('any','same_client')),
  payment_wait_days     int  not null default 10,                                              -- просрочка поступления → задача
  sells_to_az           boolean not null default false,                                        -- «можно продавать клиентам из АЗ»
  tz                    text not null default 'Asia/Baku',
  contacts              text,
  note                  text,
  active                boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table portal.project_settings add column if not exists developer_id uuid references portal.developers;
alter table portal.project_settings add column if not exists sells_to_az boolean;              -- поверх застройщика, если задано

-- Регистрация клиента у застройщика (§7): одна строка на пару клиент × застройщик
create table if not exists portal.registrations (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references portal.clients on delete cascade,
  developer_id  uuid not null references portal.developers on delete cascade,
  status        text not null default 'to_send'
                check (status in ('to_send','sent','confirmed','confirmed_silence','rejected','expired','withdrawn')),
  reject_reason text check (reject_reason in ('developer_client','other_agency','other')),
  mass          boolean not null default false,       -- массовая регистрация базы у нового застройщика (10 р. дней)
  priority      boolean not null default false,       -- клиент уже выбрал квартиру — вне очереди
  due_send      date,                                 -- SLA передачи (1 р. день; для массовой — 10)
  sent_at       timestamptz,
  answer_due    date,                                 -- срок ответа по договору
  decided_at    timestamptz,
  valid_until   date,                                 -- «Регистрация у застройщика X до»
  renew_task_at date,
  note          text,
  created_by    uuid references portal.users,
  created_at    timestamptz not null default now(),
  unique (client_id, developer_id)
);
create index if not exists registrations_status on portal.registrations (status, due_send);

-- Закрепление «чей клиент» (§10): кандидат 14 дней без защиты → 6 месяцев → продлено бронью/сделкой → передан офису
alter table portal.clients add column if not exists owner_type text not null default 'team' check (owner_type in ('team','partner','referrer'));
alter table portal.clients add column if not exists attach_status text not null default 'protected'
  check (attach_status in ('candidate','protected','extended','transferred','junk'));
alter table portal.clients add column if not exists candidate_until date;
alter table portal.clients add column if not exists attached_at timestamptz;          -- от него — 12 месяцев доли
alter table portal.clients add column if not exists previous_partner_id uuid references portal.users;
alter table portal.clients add column if not exists other_claimant_of uuid references portal.clients;  -- «другой претендент»
alter table portal.clients add column if not exists referrer_id uuid references portal.users;
alter table portal.clients add column if not exists segment text;
alter table portal.clients add column if not exists do_not_contact boolean not null default false;
alter table portal.clients add column if not exists marketing_consent_at timestamptz;
alter table portal.clients add column if not exists nurture text;
alter table portal.clients add column if not exists b24_lead_id bigint;
alter table portal.clients add column if not exists b24_contact_id bigint;
alter table portal.clients add column if not exists b24_deal_id bigint;
update portal.clients set attached_at = coalesce(attached_at, created_at);

-- Брони (§7): холд 24 ч, очередь лимита застройщика, снятие с подтверждением, № брони застройщика, причины отказа
alter table portal.bookings drop constraint if exists bookings_status_check;
alter table portal.bookings add constraint bookings_status_check
  check (status in ('hold','queued','requested','confirmed','release_pending','expired','cancelled','declined','converted'));
alter table portal.bookings add column if not exists dev_booking_no text;
alter table portal.bookings add column if not exists decline_reason text
  check (decline_reason in ('sold','developer_refused','registration_failed','other'));
alter table portal.bookings add column if not exists queued_at timestamptz;
alter table portal.bookings add column if not exists queue_until timestamptz;           -- запрос в очереди живёт 7 дней
alter table portal.bookings add column if not exists developer_id uuid references portal.developers;
alter table portal.bookings add column if not exists tour_from date;
alter table portal.bookings add column if not exists tour_to date;
alter table portal.bookings add column if not exists signing text check (signing in ('in_person','remote','power_of_attorney'));
alter table portal.bookings add column if not exists comment text;
create index if not exists bookings_unit_active on portal.bookings (unit_id) where status in ('hold','queued','requested','confirmed','release_pending');

-- Роль рекомендателя (249)
alter table portal.users drop constraint if exists users_role_check;
alter table portal.users add constraint users_role_check
  check (role in ('owner','market_head','seller','office','finance','content','agency_head','agent','referrer'));
alter table portal.users add column if not exists b24_user_id bigint unique;           -- сотрудник Bitrix24 (user.current)
alter table portal.users add column if not exists languages text[] not null default '{}';

-- Рынки и офисы (Э28)
create table if not exists portal.markets (
  code               text primary key check (code in ('DE','IL','GLOBAL')),
  name               text not null,
  countries          text not null,
  entity             text not null,
  currency           char(3) not null,
  fx_source          text not null,
  workdays           int[] not null default '{1,2,3,4,5}',   -- ISO: 1 = понедельник
  work_from          time not null default '09:00',
  work_to            time not null default '18:00',
  tz                 text not null,
  sla_minutes        int  not null default 15,
  price_negotiation  boolean not null default true,          -- 270: по умолчанию включено
  license_required   boolean not null default false,          -- 255
  languages          text[] not null default '{}',
  rtl_client_pages   boolean not null default false,          -- 273
  head_user_id       uuid references portal.users
);
insert into portal.markets (code, name, countries, entity, currency, fx_source, workdays, tz, languages, license_required, rtl_client_pages) values
  ('DE', 'DE', 'Германия, Австрия, Швейцария', 'GetsEstate GmbH', 'EUR', 'ЕЦБ', '{1,2,3,4,5}', 'Europe/Berlin', '{DE,RU,EN}', true, false),
  ('IL', 'IL', 'Израиль', 'GetsEstate IL Ltd', 'ILS', 'Банк Израиля', '{7,1,2,3,4}', 'Asia/Jerusalem', '{HE,RU,EN}', false, true),
  ('GLOBAL', 'Global', 'остальные страны', 'Caspian', 'USD', 'ЦБА', '{1,2,3,4,5,6}', 'Asia/Baku', '{RU,EN,AZ}', false, false)
on conflict (code) do nothing;

create table if not exists portal.offices (
  id        uuid primary key default gen_random_uuid(),
  market    text not null references portal.markets,
  city      text not null,
  address   text,
  phone     text,
  schedule  text,
  tz        text not null
);

-- Словари (причины Lost, сегменты, слова-табу, причины отказа брони)
create table if not exists portal.dict (
  kind   text not null check (kind in ('lost_reason','segment','taboo','decline_reason')),
  code   text not null,
  label  text not null,
  market text,
  data   jsonb not null default '{}',
  sort   int not null default 100,
  primary key (kind, code, market)
);
alter table portal.dict alter column market set default '';
update portal.dict set market = '' where market is null;
insert into portal.dict (kind, code, label, market, data, sort) values
  ('lost_reason','price','Price','', '{"nurture":"price"}',10),
  ('lost_reason','financing','Financing','', '{"nurture":"price"}',20),
  ('lost_reason','no_trust','No trust','', '{"nurture":"no_trust"}',30),
  ('lost_reason','not_ready','Not ready','', '{"nurture":"not_ready"}',40),
  ('lost_reason','no_contact','No contact','', '{"nurture":"no_contact"}',50),
  ('lost_reason','other_project','Chose other project','', '{}',60),
  ('lost_reason','other_agency','Chose other agency','', '{}',70),
  ('lost_reason','developer_client','Developer client','', '{}',80),
  ('lost_reason','registered_other','Registered with other agency','', '{}',90),
  ('lost_reason','compliance','Compliance','', '{}',100),
  ('lost_reason','other','Other','', '{}',110),
  ('decline_reason','sold','Sold','', '{}',10),
  ('decline_reason','developer_refused','Developer refused','', '{}',20),
  ('decline_reason','registration_failed','Registration failed','', '{}',30),
  ('decline_reason','other','Other','', '{}',40),
  ('segment','diaspora','Диаспора','DE','{}',10), ('segment','investor','Инвестор','DE','{}',20),
  ('segment','second_home','Второй дом','DE','{}',30), ('segment','relocation','Релокант','DE','{}',40),
  ('segment','ru_speaking','Русскоязычные','IL','{}',10), ('segment','from_az','Выходцы из АЗ','IL','{}',20),
  ('segment','he_investor','Ивритоязычные инвесторы','IL','{}',30), ('segment','plan_b','«План Б»','IL','{}',40),
  ('taboo','rendite','Rendite','DE','{}',10), ('taboo','garantiertes_einkommen','garantiertes Einkommen','DE','{}',20),
  ('taboo','passives_einkommen','passives Einkommen','DE','{}',30), ('taboo','investmentprodukt','Investmentprodukt','DE','{}',40),
  ('taboo','dohodnost','доходность','IL','{}',10), ('taboo','garant_dohod','гарантированный доход','IL','{}',20),
  ('taboo','garant_vnzh','гарантированный ВНЖ','','{}',10)
on conflict do nothing;
