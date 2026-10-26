-- Документы к заявке партнёра (разрешение §34c GewO, лицензия маклера, выписка из реестра) — видны при проверке и в карточке партнёра
set search_path = portal, public;
create table if not exists application_files (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references agent_applications on delete cascade,
  file_id        uuid not null references files on delete cascade,
  created_at     timestamptz not null default now()
);
