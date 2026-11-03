-- v2 · М4: акты вознаграждения партнёру и клаубэк. Акт появляется с договором (ожидается), к выплате — когда застройщик
-- заплатил нам, выплачено — с выплатой. Расторжение после выплаты — возврат, который вычитается из следующих актов партнёра.
set search_path = portal, public;
create table if not exists commission_acts (
  id             uuid primary key default gen_random_uuid(),
  deal_id        uuid not null unique references deals on delete cascade,
  agent_id       uuid not null references users,
  amount         numeric(14,2) not null,
  status         text not null default 'expected' check (status in ('expected','due','paid','clawback','void')),
  deducted       numeric(14,2) not null default 0,     -- вычтено из этого акта в счёт прошлых возвратов
  clawback_left  numeric(14,2) not null default 0,     -- у акта-возврата: сколько ещё не удержано
  document_id    uuid references documents on delete set null,
  due_at         timestamptz,
  paid_at        timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists commission_acts_agent on commission_acts (agent_id, status);
-- Уже существующие сделки партнёров получают акты по своей стадии
insert into commission_acts (deal_id, agent_id, amount, status, due_at, paid_at)
select d.id, d.agent_id, d.agent_amount,
  case d.stage when 'fee_received' then 'due' when 'paid_out' then 'paid' when 'cancelled' then 'void' else 'expected' end,
  case when d.stage in ('fee_received','paid_out') then now() end, case when d.stage = 'paid_out' then coalesce(d.paid_out_at::timestamptz, now()) end
from deals d where d.agent_id is not null and d.agent_amount > 0 on conflict (deal_id) do nothing;
