-- 2.2 · Ответ Дениса 11.11 на 366: лимит одновременных броней застройщика — на все его проекты вместе (Арад 5, Premium 10);
-- личный лимит партнёра и сейлза — настройка застройщика (Арад 1, Premium 3), руководитель рынка и владелец могут превысить.
-- «Эти лимиты ещё поменяются сразу после первых продаж» — поэтому просто числа в карточке застройщика.
alter table portal.developers add column if not exists max_bookings_person int not null default 3 check (max_bookings_person >= 0);
comment on column portal.developers.max_bookings_person is 'Личный лимит одновременных броней партнёра или сейлза у застройщика (все проекты)';
-- Стенд: Арад — в каталоге стенда «Sabah Investment Group» (BRABUS Island Baku)
update portal.developers set max_bookings_total = 5, max_bookings_person = 1 where name = 'Sabah Investment Group';
update portal.developers set max_bookings_total = 10, max_bookings_person = 3 where name = 'PR Premium Residence';
