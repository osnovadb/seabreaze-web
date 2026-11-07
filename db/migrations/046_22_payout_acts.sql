-- 2.2 · §8 Акт партнёра и рекомендателя за месяц по реестру: номер по счётчику без дыр, USD и валюта получателя по курсу на дату акта,
-- «Согласен с актом» (решение 247), счёт компании или ИП; без них выплата переносится
create sequence if not exists portal.payout_act_seq;
alter table portal.payout_lines add column if not exists act_no text unique;
alter table portal.payout_lines add column if not exists act_date date;
alter table portal.payout_lines add column if not exists currency char(3);
alter table portal.payout_lines add column if not exists fx_rate numeric(14,6);       -- валюты получателя за 1 USD
alter table portal.payout_lines add column if not exists fx_source text;
alter table portal.payout_lines add column if not exists amount_cur numeric(14,2);
alter table portal.payout_lines add column if not exists agreed_at timestamptz;
alter table portal.payout_lines add column if not exists agreed_by uuid references portal.users;
alter table portal.payout_lines add column if not exists invoice_file_id uuid references portal.files on delete set null;
alter table portal.payout_lines add column if not exists invoice_at timestamptz;
