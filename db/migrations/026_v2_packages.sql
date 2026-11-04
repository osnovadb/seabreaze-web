-- v2 · Группа 4: несколько квартир у клиента одним «пакетом» (квартира + машиноместо + кладовка).
-- Одна квартира — одна сделка (комиссия и акт считаются по каждой), пакет связывает брони и сделки общим group_id.
alter table portal.bookings add column if not exists group_id uuid;
alter table portal.deals add column if not exists group_id uuid;
create index if not exists bookings_group_idx on portal.bookings (group_id) where group_id is not null;
