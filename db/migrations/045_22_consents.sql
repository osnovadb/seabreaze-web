-- 2.2 · §15 Согласия и данные: журнал согласий, ссылка клиенту (галочки ставит сам клиент), напоминания 3/7/14 дней (решение 250), запросы на удаление.
create table if not exists portal.consents (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references portal.clients on delete set null,
  kind       text not null check (kind in ('data','marketing','partner_confirm')),   -- data — данные и застройщики; marketing — реклама; partner_confirm — партнёр подтвердил, что клиент в курсе
  granted    boolean not null,
  source     text not null,                  -- consent_link | website | partner_link | office | import | bitrix24 | withdraw
  text_version text not null default '2.2',
  lang       text,
  ip         text,
  by_user    uuid references portal.users on delete set null,
  at         timestamptz not null default now()
);
create index if not exists consents_client on portal.consents (client_id, at desc);

alter table portal.clients add column if not exists consent_status text not null default 'none' check (consent_status in ('none','pending','given','declined'));
alter table portal.clients add column if not exists consent_token text unique;
alter table portal.clients add column if not exists consent_requested_at timestamptz;
alter table portal.clients add column if not exists consent_reminders int not null default 0;
alter table portal.clients add column if not exists anonymized_at timestamptz;
-- уже записанные согласия считаем данными (были получены формами и галочкой)
update portal.clients set consent_status = 'given' where consent_at is not null and consent_status = 'none';

create table if not exists portal.privacy_requests (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid references portal.clients on delete set null,
  client_label text not null,                 -- номер и имя на момент запроса (после обезличивания имени уже нет)
  channel      text,                          -- email | phone | form | other
  requested_at timestamptz not null default now(),
  due_at       date not null default (current_date + 30),
  status       text not null default 'open' check (status in ('open','done','rejected')),
  result       jsonb,
  note         text,
  created_by   uuid references portal.users, done_by uuid references portal.users, done_at timestamptz
);

-- обезличивание в Bitrix24 — отдельный вид задачи очереди обмена (§13 п.24)
alter table portal.b24_jobs drop constraint if exists b24_jobs_kind_check;
alter table portal.b24_jobs add constraint b24_jobs_kind_check check (kind in ('deal_sync','client_sync','call','task','app_sync','privacy'));
