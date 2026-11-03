-- v2 · М5: заявки с сайтов и смарт-каталога. Сырая заявка хранится как пришла; дальше — проверка «чей клиент»
-- и лид в Bitrix24 через очередь (пока Bitrix24 не подключён, очередь копится и уйдёт при подключении).
set search_path = portal, public;
create table if not exists inbound_leads (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                -- website | quiz | smart_catalog | landing
  site        text,
  payload     jsonb not null,
  name        text, phone text, phone_norm text, email text, email_norm text,
  lang        text, market text,
  unit_id     uuid, project_id uuid,
  utm         jsonb,
  consent     jsonb,                        -- {text, version, at, marketing}
  result      text check (result in ('new_client','existing','partner_client','spam','error')),
  client_id   uuid references clients on delete set null,
  error       text,
  created_at  timestamptz not null default now()
);
create index if not exists inbound_leads_created on inbound_leads (created_at desc);
create index if not exists inbound_leads_phone on inbound_leads (right(phone_norm, 9), created_at desc);
create table if not exists bitrix_outbox (
  id          uuid primary key default gen_random_uuid(),
  method      text not null,                -- crm.lead.add, crm.deal.update, …
  payload     jsonb not null,
  ref_kind    text, ref_id uuid,            -- что породило: inbound_lead, booking, …
  status      text not null default 'pending' check (status in ('pending','sent','error')),
  attempts    int not null default 0,
  result      jsonb, last_error text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists bitrix_outbox_pending on bitrix_outbox (created_at) where status <> 'sent';
-- Номер клиента — из последовательности (раньше считался по count(*) и мог совпасть при одновременной регистрации)
do $$ declare m int; begin
  select coalesce(max(nullif(split_part(reg_no, '-', 3), '')::int), 141) into m from clients;  -- R-2026-0149 → 149
  if not exists (select 1 from pg_class where relname = 'client_reg_seq') then execute format('create sequence client_reg_seq start %s', m + 1); end if;
end $$;
