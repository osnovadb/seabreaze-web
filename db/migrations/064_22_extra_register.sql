-- 2.2 · Ответ Дениса 11.11 на 283: один реестр выплат в месяц плюс дополнительный по кнопке (для начислений, пришедших после основного)
alter table portal.payout_registers add column if not exists no int not null default 1;
alter table portal.payout_registers drop constraint if exists payout_registers_month_key;
create unique index if not exists payout_registers_month_no on portal.payout_registers (month, no);

-- 285: транш — фактическая сумма, дата и валюта поступления; доли начисляются от фактически полученного
alter table portal.tranches add column if not exists received_amount numeric, add column if not exists received_currency text, add column if not exists received_on date, add column if not exists received_usd numeric;
