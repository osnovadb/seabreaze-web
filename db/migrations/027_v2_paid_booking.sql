-- v2 · Группа 4: платная бронь. Взнос задаётся в условиях проекта (0 — бесплатная бронь, как раньше).
-- Офис подтверждает бронь у застройщика только после отметки «взнос получен»; при договоре взнос засчитывается в цену,
-- при снятии или истечении оплаченной брони финансы решают: вернуть или удержать.
alter table portal.conditions add column if not exists booking_fee numeric(14,2) not null default 0 check (booking_fee >= 0);
alter table portal.conditions add column if not exists booking_fee_currency char(3) not null default 'USD' check (booking_fee_currency in ('USD','AZN','EUR'));
alter table portal.bookings add column if not exists fee_amount numeric(14,2) not null default 0;
alter table portal.bookings add column if not exists fee_currency char(3) not null default 'USD';
alter table portal.bookings add column if not exists fee_usd numeric(14,2) not null default 0;
alter table portal.bookings add column if not exists fee_status text not null default 'none' check (fee_status in ('none','due','paid','credited','refunded','kept'));
alter table portal.bookings add column if not exists fee_paid_at timestamptz;
alter table portal.bookings add column if not exists fee_by uuid;
