-- 2.2 · §5 П4, §11 П9 KYC и KYB: несколько покупателей и покупка на компанию; регистрация и бронь у застройщика — на главного покупателя.
-- Документы — только в портале (5 лет, GwG); в Bitrix24 — статус и поля Co-buyers / Buyer company. Минимум (решение 251): паспорт каждого покупателя и подтверждение адреса.
create table if not exists portal.buyers (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid not null references portal.clients on delete cascade,
  kind           text not null default 'person' check (kind in ('person','company')),
  name           text not null,
  citizenship    text,                      -- для компании — страна регистрации
  tax_residence  text,
  pep            boolean,
  reg_no         text,                      -- номер в реестре (компания)
  ubo            text,                      -- бенефициары (компания)
  share_pct      numeric(5,2),
  created_at     timestamptz not null default now()
);
create index if not exists buyers_client on portal.buyers (client_id);
alter table portal.client_documents add column if not exists buyer_id uuid references portal.buyers on delete cascade;
alter table portal.client_documents drop constraint if exists client_documents_kind_check;
alter table portal.client_documents add constraint client_documents_kind_check check (kind in ('passport','address','funds','registry','ubo','director','kyc','booking','contract','payment','other'));
alter table portal.clients add column if not exists kyc_token text unique;
alter table portal.clients drop constraint if exists clients_kyc_status_check;
alter table portal.clients add constraint clients_kyc_status_check check (kyc_status in ('none','pending','passed','rejected','compliance'));
