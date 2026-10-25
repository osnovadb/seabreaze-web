-- Схема портала GetsEstate: пользователи, CRM, брони, подборки, условия, сделки, журнал.
-- Каталог (projects, buildings, units, layouts) — в public, портал его только читает.
set search_path = portal, public;

create table if not exists agencies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  market      text not null check (market in ('DE','IL','GLOBAL')),
  created_at  timestamptz not null default now()
);

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  name           text not null,
  password_hash  text not null,
  pin_hash       text,                          -- выход из режима показа
  role           text not null check (role in ('owner','market_head','seller','office','finance','content','agency_head','agent')),
  market         text check (market in ('DE','IL','GLOBAL')),
  agency_id      uuid references agencies,
  curator_id     uuid references users,         -- продавец-куратор агента
  locale         text not null default 'ru' check (locale in ('ru','en','de','he')),
  license_note   text,                          -- маклерская лицензия агента
  contract_signed_at date,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  last_login_at  timestamptz
);

create table if not exists agent_applications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('agent','agency')),
  name        text not null,
  company     text,
  email       text not null,
  phone       text,
  city        text,
  languages   text,
  license     text,
  volume      text,
  channels    text,
  market      text not null default 'DE',
  status      text not null default 'new' check (status in ('new','review','contract','approved','rejected')),
  note        text,
  reviewed_by uuid references users,
  created_at  timestamptz not null default now()
);

-- Коммерческие условия проекта: версии с датой вступления
create table if not exists conditions (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null,
  version               int not null,
  status                text not null default 'draft' check (status in ('draft','published')),
  valid_from            date not null default current_date,
  fix_pct               numeric(5,2) not null,   -- от итоговой цены
  pool_pct              numeric(5,2) not null,   -- от прайса
  agent_fix_pct         numeric(5,2) not null,
  agent_pool_pct        numeric(5,2) not null,
  agent_our_pool_share  numeric(5,2) not null default 0,
  seller_share_pct      numeric(5,2) not null default 0,
  seller_self_disc      numeric(5,2) not null default 10,
  seller_max_disc       numeric(5,2) not null default 20,
  booking_days          int not null default 14,
  booking_ext_days      int not null default 14,
  protect_months        int not null default 3,
  max_bookings_client   int not null default 3,
  max_bookings_agent    int not null default 3,
  max_bookings_total    int not null default 10,
  pay_timing            text not null default 'after_first_payment',
  payment_plans         jsonb not null default '[]',
  note                  text,
  created_by            uuid references users,
  created_at            timestamptz not null default now(),
  unique (project_id, version)
);

create table if not exists agent_rates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null,
  market       text,
  agency_id    uuid references agencies,
  agent_id     uuid references users,
  agent_fix_pct  numeric(5,2) not null,
  agent_pool_pct numeric(5,2) not null,
  note         text
);

create table if not exists clients (
  id              uuid primary key default gen_random_uuid(),
  reg_no          text unique,
  owner_id        uuid not null references users,
  agency_id       uuid references agencies,
  name            text not null,
  phone           text,
  phone_norm      text,
  email           text,
  email_norm      text,
  country         text,
  language        text,
  market          text,
  consent_at      timestamptz,
  source          text,
  goal            text,
  budget          text,
  timeline        text,
  payment         text,
  interest        text,
  stage           text not null default 'lead',
  pause_until     date,
  lost_reason     text,
  protected_until date,
  kyc_status      text not null default 'none' check (kyc_status in ('none','pending','passed','rejected')),
  last_activity_at timestamptz not null default now(),
  created_at      timestamptz not null default now()
);
create index if not exists clients_phone on clients (phone_norm);
create index if not exists clients_email on clients (email_norm);

create table if not exists fixations (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients on delete cascade,
  project_id    uuid not null,
  status        text not null default 'sent' check (status in ('sent','approved','rejected')),
  sent_at       timestamptz not null default now(),
  decided_at    timestamptz,
  protected_until date,
  unique (client_id, project_id)
);

create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients on delete cascade,
  user_id     uuid references users,
  kind        text not null,      -- note, call, meeting, message, email, system
  text        text not null,
  internal    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists tasks (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients on delete cascade,
  user_id     uuid not null references users,
  title       text not null,
  due         date,
  done        boolean not null default false,
  auto        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists bookings (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null,
  project_id    uuid not null,
  client_id     uuid not null references clients,
  agent_id      uuid not null references users,
  status        text not null default 'requested' check (status in ('requested','confirmed','expired','cancelled','converted')),
  price_list    numeric(14,2) not null,
  currency      char(3) not null default 'USD',
  discount_pct  numeric(5,2) not null default 0,
  final_price   numeric(14,2) not null,
  conditions_id uuid references conditions,
  snapshot      jsonb not null,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz not null,
  extended      boolean not null default false,
  confirmed_by  uuid references users,
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists bookings_unit on bookings (unit_id) where status in ('requested','confirmed');

create table if not exists deals (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid references bookings,
  client_id     uuid not null references clients,
  unit_id       uuid not null,
  project_id    uuid not null,
  agent_id      uuid references users,
  seller_id     uuid references users,
  stage         text not null default 'contract' check (stage in ('contract','payments','fee_received','paid_out','cancelled')),
  final_price   numeric(14,2) not null,
  agent_amount  numeric(14,2) not null default 0,
  our_amount    numeric(14,2) not null default 0,
  seller_amount numeric(14,2) not null default 0,
  paid_pct      numeric(5,2) not null default 0,
  paid_out_at   date,
  created_at    timestamptz not null default now()
);

create table if not exists selections (
  id          uuid primary key default gen_random_uuid(),
  token       text not null unique,
  client_id   uuid not null references clients on delete cascade,
  user_id     uuid not null references users,
  title       text,
  lang        text not null default 'de',
  opened      int not null default 0,
  last_opened_at timestamptz,
  created_at  timestamptz not null default now()
);
create table if not exists selection_items (
  selection_id uuid not null references selections on delete cascade,
  unit_id      uuid not null,
  note         text,
  liked        boolean not null default false,
  sort         int not null default 0,
  primary key (selection_id, unit_id)
);

create table if not exists notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users on delete cascade,
  kind        text not null,
  text        text not null,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists audit (
  id          bigserial primary key,
  user_id     uuid references users,
  as_user_id  uuid references users,
  action      text not null,
  entity      text,
  entity_id   text,
  data        jsonb,
  created_at  timestamptz not null default now()
);

-- Генплан: картинка и контуры домов (координаты в долях 0..1)
create table if not exists genplans (
  project_id  uuid primary key,
  image       text not null,
  polygons    jsonb not null default '[]',
  note        text
);

create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());
