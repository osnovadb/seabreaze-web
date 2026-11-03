-- v2 · М8: документы из шаблонов docx. Шаблон — по виду и языку, версии; номер — по счётчику вида на год.
set search_path = portal, public;
create table if not exists doc_templates (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('booking_offer','fixation_act','commission_act')),
  lang       text not null check (lang in ('ru','en','de','he')),
  version    int not null,
  name       text not null,
  file_id    uuid not null references files,
  vars       text[] not null default '{}',
  active     boolean not null default true,
  created_by uuid references users,
  created_at timestamptz not null default now(),
  unique (kind, lang, version)
);
create unique index if not exists doc_templates_active on doc_templates (kind, lang) where active;
create table if not exists doc_numbers (
  kind text not null,
  year int not null,
  last int not null default 0,
  primary key (kind, year)
);
create table if not exists documents (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid not null references doc_templates,
  kind           text not null,
  number         text not null unique,
  lang           text not null,
  client_id      uuid references clients on delete cascade,
  booking_id     uuid references bookings on delete set null,
  project_id     uuid,
  status         text not null default 'draft' check (status in ('draft','sent','signed','void')),
  docx_file_id   uuid references files,
  pdf_file_id    uuid references files,
  signed_file_id uuid references files,
  data           jsonb not null,
  created_by     uuid references users,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz,
  signed_at      timestamptz
);
create index if not exists documents_client on documents (client_id);
