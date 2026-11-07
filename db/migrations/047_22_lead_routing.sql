-- 2.2 · §10 «Распределение и SLA» / §12 «Роботы: лид New»: назначение по рынку и языку с учётом нагрузки, первый контакт за 15 минут в рабочее время,
-- не принятый вовремя лид — следующему сейлзу (в другой рынок не переводим). На лиды Source = Partner не срабатывает.
create table if not exists portal.lead_assign (
  id          bigserial primary key,
  lead_id     bigint not null,
  user_id     uuid not null references portal.users on delete cascade,
  market      text,
  lang        text,
  task_id     bigint,
  assigned_at timestamptz not null default now(),
  deadline    timestamptz not null,
  status      text not null default 'open' check (status in ('open','accepted','passed','closed')),
  unique (lead_id, user_id)
);
create index if not exists lead_assign_open on portal.lead_assign (deadline) where status = 'open';
