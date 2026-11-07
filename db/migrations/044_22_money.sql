-- 2.2 · §8 Деньги: доли по ролям из условий проекта, транши комиссии застройщика, начисления по полученным траншам,
-- месячный реестр выплат, клаубэк и долг партнёра, удержание налога. Суммы — в USD, без НДС на комиссию (решение 204).

-- Ставки ролей в условиях проекта (версии условий — как раньше)
alter table portal.conditions add column if not exists head_bonus_pct   numeric(5,2) not null default 0;     -- руководитель рынка, % от нашей выручки
alter table portal.conditions add column if not exists escort_fix_usd   numeric(10,2) not null default 500;  -- сопровождающий в Баку, фикс за продажу
alter table portal.conditions add column if not exists referrer_pct     numeric(5,2) not null default 2;     -- рекомендатель, % от итоговой цены договора
alter table portal.conditions add column if not exists consultant_pct   numeric(5,2) not null default 1;     -- консультант по застройщикам (решение 265), от цены без НДС
alter table portal.conditions add column if not exists vat_rate         numeric(5,2) not null default 18;    -- НДС в цене квартиры (для «без НДС»)
alter table portal.conditions add column if not exists consultant_name  text default 'Консультант по застройщикам';

-- Сделка: сопровождающий (назначает бэк-офис при Reserved), комиссия застройщика всего, закрытие
alter table portal.bookings add column if not exists escort_id uuid references portal.users on delete set null;
alter table portal.deals add column if not exists escort_id uuid references portal.users on delete set null;
alter table portal.deals add column if not exists commission_total numeric(14,2) not null default 0;
alter table portal.deals add column if not exists terminated_at timestamptz;
alter table portal.deals add column if not exists closed_at timestamptz;

-- Доли по сделке: кому сколько всего (начисляется частями — по полученным траншам)
create table if not exists portal.deal_shares (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references portal.deals on delete cascade,
  role      text not null check (role in ('partner','referrer','consultant','escort','seller','market_head','caspian')),
  user_id   uuid references portal.users on delete set null,
  recipient text,                               -- получатель без пользователя портала (консультант, подрядчик)
  pct       numeric(7,3),
  amount    numeric(14,2) not null,
  unique (deal_id, role)
);

-- Транши комиссии застройщика: график из условий («когда платит») и оплат клиента
create table if not exists portal.tranches (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references portal.deals on delete cascade,
  no          int not null,
  pct         numeric(7,3) not null,            -- доля от всей комиссии по продаже
  amount      numeric(14,2) not null,
  trigger     text not null,                    -- first_payment | deposit_35 | paid:<доля>
  due_from    date,                             -- условие выполнено (оплата клиента внесена)
  expected_at date,                             -- ожидаем поступление: due_from + срок ожидания из условий
  status      text not null default 'expected' check (status in ('scheduled','expected','received','cancelled')),
  received_at timestamptz, received_by uuid references portal.users,
  unique (deal_id, no)
);
create index if not exists tranches_status on portal.tranches (status, expected_at);

-- Начисления: по полученному траншу каждой доле; корректировки и клаубэк — отдельными строками (выданные акты не правим)
create table if not exists portal.payout_registers (
  id            uuid primary key default gen_random_uuid(),
  month         date not null unique,           -- первое число месяца среза
  status        text not null default 'collected' check (status in ('collected','approved','paid')),
  confirmations jsonb not null default '{}',    -- рынок → {by, at}: руководитель рынка подтвердил свой рынок
  collected_at  timestamptz not null default now(), collected_by uuid references portal.users,
  approved_at   timestamptz, approved_by uuid references portal.users,
  paid_at       timestamptz, paid_by uuid references portal.users
);
create table if not exists portal.accruals (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid references portal.deals on delete set null,
  tranche_id  uuid references portal.tranches on delete set null,
  role        text not null,
  user_id     uuid references portal.users on delete set null,
  recipient   text,
  kind        text not null default 'share' check (kind in ('share','adjustment','clawback','writeoff')),
  amount      numeric(14,2) not null,           -- минус — клаубэк / удержание
  month       date not null,                    -- месяц поступления в Caspian (срез)
  status      text not null default 'open' check (status in ('open','in_register','paid','void')),
  register_id uuid references portal.payout_registers on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists accruals_open on portal.accruals (status, month);
create index if not exists accruals_user on portal.accruals (user_id, status);
-- Строки реестра: получатель за месяц (сумма, удержание налога, документ)
create table if not exists portal.payout_lines (
  id          uuid primary key default gen_random_uuid(),
  register_id uuid not null references portal.payout_registers on delete cascade,
  role        text not null,
  user_id     uuid references portal.users on delete set null,
  recipient   text,
  market      text,
  gross       numeric(14,2) not null,
  withheld    numeric(14,2) not null default 0,
  net         numeric(14,2) not null,
  doc_ok      boolean not null default true,
  carried     boolean not null default false,  -- перенесено: меньше 100 $ или нет документа
  note        text
);

-- Карточка партнёра для выплат: форма, НДС, налоговое резидентство и сертификат, смена реквизитов
alter table portal.users add column if not exists partner_form text check (partner_form in ('company','sole','individual'));
alter table portal.users add column if not exists vat_payer boolean not null default false;
alter table portal.users add column if not exists vat_no text;
alter table portal.users add column if not exists tax_country text;
alter table portal.users add column if not exists tax_no text;
alter table portal.users add column if not exists tax_cert_until date;
alter table portal.users add column if not exists bank_changed_at timestamptz;
-- Ставки удержания при выплате за границу без сертификата (настраивают финансы): юрлицо × страна
create table if not exists portal.withholding (entity text not null, country text not null, rate numeric(5,2) not null, primary key (entity, country));
