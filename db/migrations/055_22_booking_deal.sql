-- 2.2 · «Правила работы» гл. 6, строка 2 (решение 342): одна квартира — одна сделка Bitrix24, начиная с подтверждённой брони.
-- Первая подтверждённая бронь клиента ведётся в его сделке; каждая следующая — в своей сделке того же клиента (тот же контакт, воронка, закрепление).
alter table portal.bookings add column if not exists b24_deal_id bigint;
create index if not exists bookings_b24_deal on portal.bookings (b24_deal_id) where b24_deal_id is not null;
