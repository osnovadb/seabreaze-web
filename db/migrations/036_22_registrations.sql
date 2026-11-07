-- 2.2 · Регистрации у застройщиков (§7): рабочие дни по календарю Баку и постановка клиента в очередь ко всем застройщикам.

-- n рабочих дней после d (пн–пт; праздники Баку — позже, отдельной таблицей)
create or replace function portal.add_workdays(d date, n int) returns date language plpgsql immutable as $$
declare r date := d; k int := 0;
begin
  while k < n loop
    r := r + 1;
    if extract(isodow from r) < 6 then k := k + 1; end if;
  end loop;
  return r;
end $$;

-- Клиент из Азербайджана: проекты без галочки «можно продавать клиентам из АЗ» пропускаем (§7 п.1, §10)
create or replace function portal.is_az_country(c text) returns boolean language sql immutable as $$
  select lower(coalesce(c, '')) in ('az', 'aze', 'azerbaijan', 'азербайджан', 'aserbaidschan', 'azərbaycan')
$$;

-- Поставить клиента в очередь регистрации у всех действующих застройщиков; mass — массовая регистрация базы у нового застройщика
create or replace function portal.enqueue_registrations(cid uuid, dev uuid default null, is_mass boolean default false, by_user uuid default null)
returns int language plpgsql as $$
declare n int;
begin
  insert into portal.registrations (client_id, developer_id, status, mass, due_send, created_by)
    select c.id, d.id, 'to_send', is_mass, portal.add_workdays(current_date, case when is_mass then 10 else 1 end), by_user
    from portal.clients c cross join portal.developers d
    where c.id = cid and d.active and (dev is null or d.id = dev)
      and not c.do_not_contact and c.attach_status <> 'junk'
      -- застройщику без продаж в АЗ — только когда страна клиента известна и это не АЗ
      and (d.sells_to_az or (coalesce(c.country, '') <> '' and not portal.is_az_country(c.country)))
    on conflict (client_id, developer_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
