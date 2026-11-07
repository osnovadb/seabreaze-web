-- QA 09.11: гонка — два холда (или запроса) на одну квартиру одновременно. Одна активная бронь на квартиру — правилом базы.
-- Найденные дубли: оставляем самую раннюю, остальные снимаем.
update portal.bookings b set status = 'cancelled'
where b.status in ('hold','queued','requested','confirmed','release_pending')
  and exists (select 1 from portal.bookings x where x.unit_id = b.unit_id and x.status in ('hold','queued','requested','confirmed','release_pending')
    and (x.created_at, x.id) < (b.created_at, b.id));
create unique index if not exists bookings_one_active_per_unit on portal.bookings (unit_id) where status in ('hold','queued','requested','confirmed','release_pending');
