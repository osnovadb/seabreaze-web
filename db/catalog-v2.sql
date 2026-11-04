-- v2 · Изменения схемы каталога (выполняет суперпользователь базы, не миграции портала — таблицы каталога принадлежат ему).
-- Тип помещения «кладовка» (у Profitbase есть, у нас не было).
alter table units drop constraint if exists units_unit_type_check;
alter table units add constraint units_unit_type_check check (unit_type = any (array['studio','1br','2br','3br','4br','duplex','penthouse','townhouse','villa','commercial','parking','storage']));

-- Журнал квартиры для портала (portal.unit_events, миграция 024): любая правка статуса или цены — из портала, Directus или синхронизации.
-- Кто правил — app.user_id, откуда — app.change_source (портал ставит их в своей транзакции), синхронизация — app.sync_source.
create or replace function portal_unit_events() returns trigger language plpgsql security definer set search_path = public, portal as $$
declare
  src text := coalesce('sync:' || nullif(current_setting('app.sync_source', true), ''), nullif(current_setting('app.change_source', true), ''), 'manual');
  uid uuid := nullif(current_setting('app.user_id', true), '')::uuid;
begin
  if tg_op = 'INSERT' then
    insert into portal.unit_events (unit_id, kind, new_value, new_price, currency, source, user_id) values (new.id, 'created', new.status, new.price_list, new.price_currency, src, uid);
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into portal.unit_events (unit_id, kind, old_value, new_value, source, user_id) values (new.id, 'status', old.status, new.status, src, uid);
  end if;
  if new.price_list is distinct from old.price_list or new.price_currency is distinct from old.price_currency then
    insert into portal.unit_events (unit_id, kind, old_price, new_price, currency, source, user_id) values (new.id, 'price', old.price_list, new.price_list, new.price_currency, src, uid);
  end if;
  return new;
end $$;
drop trigger if exists units_portal_events on units;
create trigger units_portal_events after insert or update on units for each row execute function portal_unit_events();

-- Синхронизация с Profitbase (М1, М11): портал ведёт источники, журнал прогонов и сопоставление статусов
grant select, insert, update on sources, sync_runs, status_map, type_map to portal_app;
grant usage on sequence sync_runs_id_seq, status_map_id_seq, type_map_id_seq to portal_app;
