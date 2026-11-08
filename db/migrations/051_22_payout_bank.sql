-- 2.2 · QA 09.11 (ручной прогон): партнёру и рекомендателю негде было указать, куда платить.
-- Реквизиты получателя; смена IBAN/SWIFT ставит bank_changed_at — реестр держит выплату 3 дня (защита от подмены реквизитов).
alter table portal.users add column if not exists bank_holder text;
alter table portal.users add column if not exists bank_iban text;
alter table portal.users add column if not exists bank_swift text;
alter table portal.users add column if not exists bank_name text;
