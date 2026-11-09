-- QA 2.2 · уборка перед прогоном (только QA-копия seabreeze_qa22): брони и сделки прошлых автопрогонов освобождают квартиры,
-- иначе после ~20 прогонов «нет свободной квартиры». Только пользователи автотестов qa-…@qa.test; ручной QA (steiner@qa.test и т.п.) не трогаем.
\set ON_ERROR_STOP on
select current_database() = 'seabreeze_qa22' as ok \gset
\if :ok
update portal.deals d set stage = 'cancelled' from portal.bookings b join portal.users u on u.id = b.agent_id
  where d.booking_id = b.id and u.email like 'qa-%@qa.test' and d.stage <> 'cancelled' and b.created_at < now() - interval '1 hour';
update portal.bookings b set status = 'cancelled' from portal.users u
  where u.id = b.agent_id and u.email like 'qa-%@qa.test' and b.status in ('hold','queued','requested','confirmed','release_pending','converted') and b.created_at < now() - interval '1 hour';
\else
\echo 'not the QA database — skipped'
\endif
