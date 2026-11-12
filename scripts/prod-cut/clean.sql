-- Портал 2.2 → бой: чистка копии базы стенда перед переносом (план переезда, «что переносим»).
-- Запуск на ВРЕМЕННОЙ копии seabreeze_v22 (portal_cut), никогда на стенде: psql -v ON_ERROR_STOP=1 -d portal_cut -f clean.sql
-- Остаются каталог (проекты, корпуса, квартиры, планировки, условия, разметка, генпланы, шаблоны, словари) без людей, клиентов, сделок,
-- журналов, очередей обмена и тестовых проектов/квартир. Ограничения FK на время чистки выключены (replica), целостность проверяет check.sql.
begin;
set session_replication_role = replica;

-- 1. Тестовые проекты, источники и квартиры
create temp table tproj as select id from public.projects where slug in ('test-marina');
create temp table tbld as select id from public.buildings where project_id in (select id from tproj) or name = 'ТЕСТ · QA';
create temp table tunit as select id from public.units where project_id in (select id from tproj) or building_id in (select id from tbld) or source_id in ('test', 'pb:mock');

-- 2. Портал: всё, что про людей, клиентов, деньги, обмен и журналы — пусто
do $$ declare t text; begin
  foreach t in array array['accruals','activities','agencies','agent_applications','agent_rates','application_files','audit','auth_tokens','b24_inbox','b24_jobs',
    'bitrix_outbox','bookings','buyers','calc_variants','clawback_requests','client_documents','clients','commission_acts','consents','deal_shares','deals','disputes',
    'doc_numbers','documents','fixations','inbound_leads','kv','lead_assign','login_attempts','notifications','outbox_messages','partner_links','payout_lines',
    'payout_registers','pb_outbox','post_reads','posts','price_list_items','price_lists','privacy_requests','project_exceptions','project_files','registrations',
    'sales_plans','saved_searches','selection_items','selection_variants','selections','special_offers','tasks','tranches','unit_events','user_devices','users',
    'waitlist','withholding']
  loop
    if to_regclass('portal.' || t) is not null then execute format('delete from portal.%I', t); end if;
  end loop;
end $$;

-- ссылки на пользователей в переносимых таблицах
update portal.conditions set created_by = null;
update portal.doc_templates set created_by = null;
update portal.down_discounts set created_by = null;
update portal.markets set head_user_id = null;
update portal.unit_hidden set created_by = null;
update portal.files set created_by = null;

-- разметка и настройки тестовых проектов и корпусов
delete from portal.floor_plans where building_id in (select id from tbld);
delete from portal.facades where building_id in (select id from tbld);
delete from portal.riser_info where building_id in (select id from tbld);
delete from portal.building_sides where building_id in (select id from tbld);
delete from portal.unit_options where project_id in (select id from tproj);
delete from portal.unit_hidden where unit_id in (select id from tunit);
delete from portal.genplans where project_id in (select id from tproj);
delete from portal.project_settings where project_id in (select id from tproj);
delete from portal.conditions where project_id in (select id from tproj);
delete from portal.down_discounts where project_id in (select id from tproj) or building_id in (select id from tbld);

-- 3. Каталог (public): тестовое и не нужное порталу
delete from public.price_history;
delete from public.sync_runs;
delete from public.pricing_rules where project_id is not null or unit_id is not null or building_id is not null or layout_id is not null;
delete from public.units where id in (select id from tunit);
delete from public.layouts l where l.project_id in (select id from tproj) or not exists (select 1 from public.units u where u.layout_id = l.id);
delete from public.payment_plans where project_id in (select id from tproj) or building_id in (select id from tbld);
delete from public.project_markets where project_id in (select id from tproj);
delete from public.project_purposes where project_id in (select id from tproj);
delete from public.project_content where project_id in (select id from tproj);
delete from public.buildings where id in (select id from tbld);
delete from public.projects where id in (select id from tproj);
delete from public.status_map where source_id in ('test', 'pb:mock');
delete from public.type_map where source_id in ('test', 'pb:mock');
delete from public.sources where id in ('test', 'pb:mock');
do $$ declare t text; begin
  foreach t in array array['agents','articles','consents','consultants','documents','events','facts','faq','leads','map_points','media','news','page_blocks',
    'pages','places','stories','translations','trips','videos']
  loop
    if to_regclass('public.' || t) is not null then execute format('delete from public.%I', t); end if;
  end loop;
end $$;

-- 4. Directus: служебные данные (пользователи, сессии, журнал) не переносим; из файлов — только листы планировок
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'directus\_%' and tablename <> 'directus_files' loop
    execute format('delete from public.%I', t);
  end loop;
end $$;
delete from public.directus_files f where not exists (select 1 from public.layouts l where l.plan_file = f.id);
update public.directus_files set folder = null, uploaded_by = null, modified_by = null;

-- 5. Файлы портала — только те, на которые ссылаются оставшиеся строки
delete from portal.files f where not exists (select 1 from portal.floor_plans x where x.file_id = f.id)
  and not exists (select 1 from portal.facades x where x.file_id = f.id)
  and not exists (select 1 from portal.genplans x where x.file_id = f.id or x.image like '%' || f.id || '%' or x.views::text like '%' || f.id || '%')
  and not exists (select 1 from portal.doc_templates x where x.file_id = f.id)
  and not exists (select 1 from portal.project_settings x where x.cover_file_id = f.id);

set session_replication_role = origin;
commit;
