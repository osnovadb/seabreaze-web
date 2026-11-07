-- 2.2 · Рынок DE или IL — страна клиента известна и это не АЗ: регистрировать и у застройщиков без продаж клиентам из АЗ
create or replace function portal.enqueue_registrations(cid uuid, dev uuid default null, is_mass boolean default false, by_user uuid default null)
returns int language plpgsql as $$
declare n int;
begin
  insert into portal.registrations (client_id, developer_id, status, mass, due_send, created_by)
    select c.id, d.id, 'to_send', is_mass, portal.add_workdays(current_date, case when is_mass then 10 else 1 end), by_user
    from portal.clients c cross join portal.developers d
    where c.id = cid and d.active and (dev is null or d.id = dev)
      and not c.do_not_contact and c.attach_status not in ('junk','candidate')
      and (d.sells_to_az or (not portal.is_az_country(c.country) and (coalesce(c.country, '') <> '' or c.market in ('DE','IL'))))
    on conflict (client_id, developer_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
-- уже заведённые клиенты команды — в очередь
select portal.enqueue_registrations(id) from portal.clients where attach_status in ('protected','extended') and owner_type = 'team';
