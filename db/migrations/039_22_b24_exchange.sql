-- 2.2 · §13 Обмен с Bitrix24: исходящая очередь с повторами, журнал входящих событий (одно событие — одна обработка), зеркало сделки у клиента.

-- Исходящие: deal_sync — собрать состояние клиента и записать в сделку (склеивается: одна ожидающая задача на клиента, записи в ленту копятся);
-- client_sync — завести или обновить лид / контакт / сделку клиента партнёра (события 4, 5, 23); call — произвольный метод REST
create table if not exists portal.b24_jobs (
  id          bigserial primary key,
  kind        text not null check (kind in ('deal_sync','client_sync','call')),
  ref_id      uuid,
  method      text,
  params      jsonb,
  notes       text[] not null default '{}',
  status      text not null default 'pending' check (status in ('pending','running','sent','error','dead')),
  attempts    int not null default 0,
  next_at     timestamptz not null default now(),
  last_error  text,
  result      jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create unique index if not exists b24_jobs_one_pending on portal.b24_jobs (kind, ref_id) where status in ('pending','error') and ref_id is not null and kind <> 'call';
create index if not exists b24_jobs_due on portal.b24_jobs (next_at) where status in ('pending','error');
create index if not exists b24_jobs_created on portal.b24_jobs (created_at desc);

-- Входящие: что пришло из Bitrix24 и как обработано. Ключ — сущность, ID и версия (DATE_MODIFY / ID комментария): повтор не обрабатывается
create table if not exists portal.b24_inbox (
  id          bigserial primary key,
  entity      text not null,               -- deal | lead | contact | user | comment
  b24_id      bigint not null,
  version     text not null,
  event       int,                         -- номер события §13
  client_id   uuid references portal.clients on delete set null,
  result      text not null,               -- что сделали (коротко, для журнала)
  data        jsonb,
  created_at  timestamptz not null default now(),
  unique (entity, b24_id, version)
);
create index if not exists b24_inbox_created on portal.b24_inbox (created_at desc);

-- Зеркало сделки Bitrix24 у клиента портала
alter table portal.clients add column if not exists b24_category int;
alter table portal.clients add column if not exists b24_stage_id text;
alter table portal.clients add column if not exists b24_stage text;            -- название стадии (партнёр видит его как есть, §13 п.15)
alter table portal.clients add column if not exists b24_semantic text;         -- P в работе, S успех, F провал
alter table portal.clients add column if not exists b24_assigned_id bigint;    -- ответственный в Bitrix24
alter table portal.clients add column if not exists b24_synced_at timestamptz;
alter table portal.clients add column if not exists terminated_at timestamptz;  -- §13 п.14: расторжение
alter table portal.clients add column if not exists clawback boolean not null default false;
create index if not exists clients_b24_deal on portal.clients (b24_deal_id) where b24_deal_id is not null;
create index if not exists clients_b24_contact on portal.clients (b24_contact_id) where b24_contact_id is not null;
create index if not exists clients_b24_lead on portal.clients (b24_lead_id) where b24_lead_id is not null;

-- С какого момента портал сам заводит лиды, контакты и сделки в Bitrix24 (клиенты стенда до этого — только обновляются, если уже связаны)
insert into portal.kv (key, value) values ('b24:create_from', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) on conflict (key) do nothing;
