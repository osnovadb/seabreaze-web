-- 2.2 · «Правила работы» гл. 6, строка 3 (решение 341): стадии после Selection двигает только портал.
-- «Договор на согласовании» (SPA approval) — отметка бэк-офиса по брони, доступна после пройденного KYC.
alter table portal.bookings add column if not exists spa_approval_at timestamptz;
alter table portal.bookings add column if not exists spa_approval_by uuid references portal.users(id);
