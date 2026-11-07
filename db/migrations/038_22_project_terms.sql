-- 2.2 · Условия — на проект, с версиями по датам (решение Дениса 08.11): регистрация, молчание, защита, бронь, комиссия, клаубэк, НДС, опции, АЗ.
-- Карточка застройщика остаётся справочником и источником значений по умолчанию для первой версии условий нового проекта.

alter table portal.conditions add column if not exists reg_method          text not null default 'email' check (reg_method in ('crm','email','api','file'));
alter table portal.conditions add column if not exists reg_response_days   int  not null default 3;
alter table portal.conditions add column if not exists silence_rule        text not null default 'remind' check (silence_rule in ('confirm','remind'));
alter table portal.conditions add column if not exists silence_extra_days  int  not null default 0;
alter table portal.conditions add column if not exists reg_protect_months  int  not null default 6;
alter table portal.conditions add column if not exists reg_protect_months_sub int;
alter table portal.conditions add column if not exists renew_remind_days   int  not null default 7;
alter table portal.conditions add column if not exists booking_write_api   boolean not null default false;
alter table portal.conditions add column if not exists rates_by_market     jsonb not null default '{}';
alter table portal.conditions add column if not exists vat_mode            text not null default 'over' check (vat_mode in ('over','incl'));
alter table portal.conditions add column if not exists options_in_base     boolean not null default false;
alter table portal.conditions add column if not exists fx_rule             text;
alter table portal.conditions add column if not exists clawback_months     int  not null default 3;
alter table portal.conditions add column if not exists clawback_offset     text not null default 'any' check (clawback_offset in ('any','same_client'));
alter table portal.conditions add column if not exists payment_wait_days   int  not null default 10;
alter table portal.conditions add column if not exists sells_to_az         boolean not null default false;

-- Перенести то, что уже ввели в карточки застройщиков, во все версии условий их проектов
update portal.conditions c set reg_method = d.reg_method, reg_response_days = d.reg_response_days, silence_rule = d.silence_rule, silence_extra_days = d.silence_extra_days,
    reg_protect_months = d.protect_months, reg_protect_months_sub = d.protect_months_sub, renew_remind_days = d.renew_remind_days, booking_write_api = d.booking_write_api,
    rates_by_market = d.rates_by_market, vat_mode = d.vat_mode, options_in_base = d.options_in_base, fx_rule = d.fx_rule, clawback_months = d.clawback_months,
    clawback_offset = d.clawback_offset, payment_wait_days = d.payment_wait_days, sells_to_az = d.sells_to_az
  from public.projects p join portal.developers d on d.catalog_id = p.developer_id
  where p.id = c.project_id;

-- Действующая версия условий проекта на сегодня
create or replace function portal.cur_conditions(pid uuid) returns portal.conditions language sql stable as $$
  select * from portal.conditions where project_id = pid and status = 'published' and valid_from <= current_date order by valid_from desc, version desc limit 1
$$;

-- Регистрации — по проекту (у каждого проекта свои сроки и правило молчания); застройщик остаётся для пакетной отправки
alter table portal.registrations add column if not exists project_id uuid;
insert into portal.registrations (client_id, developer_id, project_id, status, reject_reason, mass, priority, due_send, sent_at, answer_due, decided_at, valid_until, renew_task_at, note, created_by, created_at)
  select r.client_id, r.developer_id, p.id, r.status, r.reject_reason, r.mass, r.priority, r.due_send, r.sent_at, r.answer_due, r.decided_at, r.valid_until, r.renew_task_at, r.note, r.created_by, r.created_at
  from portal.registrations r join portal.developers d on d.id = r.developer_id join public.projects p on p.developer_id = d.catalog_id
  where r.project_id is null;
delete from portal.registrations where project_id is null;
alter table portal.registrations alter column project_id set not null;
alter table portal.registrations drop constraint if exists registrations_client_id_developer_id_key;
create unique index if not exists registrations_client_project on portal.registrations (client_id, project_id);

-- Поставить клиента в очередь регистрации по всем проектам в продаже (условия опубликованы); правило АЗ — из условий проекта
create or replace function portal.enqueue_registrations(cid uuid, dev uuid default null, is_mass boolean default false, by_user uuid default null)
returns int language plpgsql as $$
declare n int;
begin
  insert into portal.registrations (client_id, developer_id, project_id, status, mass, due_send, created_by)
    select c.id, d.id, p.id, 'to_send', is_mass, portal.add_workdays(current_date, case when is_mass then 10 else 1 end), by_user
    from portal.clients c
    cross join public.projects p
    join portal.developers d on d.catalog_id = p.developer_id and d.active
    join portal.project_settings ps on ps.project_id = p.id and ps.sales_status in ('sales','stop')
    cross join lateral (select * from portal.cur_conditions(p.id)) k
    where c.id = cid and (dev is null or d.id = dev) and k.id is not null
      and not c.do_not_contact and c.attach_status not in ('junk','candidate')
      and (k.sells_to_az or (not portal.is_az_country(c.country) and (coalesce(c.country, '') <> '' or c.market in ('DE','IL'))))
    on conflict (client_id, project_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
select portal.enqueue_registrations(id) from portal.clients where attach_status in ('protected','extended') and owner_type = 'team';
