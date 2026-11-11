-- QA 2.2 · уборка перед прогоном (только QA-копия seabreeze_qa22): брони и сделки прошлых автопрогонов освобождают квартиры,
-- иначе после ~20 прогонов «нет свободной квартиры». Только пользователи автотестов qa-…@qa.test; ручной QA (steiner@qa.test и т.п.) не трогаем.
\set ON_ERROR_STOP on
select current_database() = 'seabreeze_qa22' as ok \gset
\if :ok
update portal.deals d set stage = 'cancelled' from portal.bookings b join portal.users u on u.id = b.agent_id
  where d.booking_id = b.id and u.email like 'qa-%@qa.test' and d.stage <> 'cancelled';
-- О13: у сделок автотестов, снятых уборкой, — и ожидаемые транши
update portal.tranches t set status = 'cancelled' from portal.deals d where d.id = t.deal_id and d.stage = 'cancelled' and t.status in ('scheduled','expected');
update portal.bookings b set status = 'cancelled' from portal.users u
  where u.id = b.agent_id and u.email like 'qa-%@qa.test' and b.status in ('hold','queued','requested','confirmed','release_pending','converted');
-- лимит «10 заявок с адреса за час» на ссылке партнёра: прошлые прогоны шли с 127.0.0.1 — снимаем у них адрес, чтобы новый прогон не упёрся в лимит
update portal.inbound_leads set payload = payload - 'ip' where source = 'partner_link' and payload->>'ip' in ('127.0.0.1', '::1', '::ffff:127.0.0.1', '');
-- 366: лимиты застройщика на время прогона снимаем (наборы ставят их сами, где проверяют); после прогона run.sh возвращает настоящие
update portal.developers set max_bookings_total = 1000, max_bookings_person = 1000;
-- 358: лимит заявок с адреса — прошлые прогоны шли с 127.0.0.1
update portal.agent_applications set ip = null where ip in ('127.0.0.1', '::1', '::ffff:127.0.0.1');
\else
\echo 'not the QA database — skipped'
\endif
