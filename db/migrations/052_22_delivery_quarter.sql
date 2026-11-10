-- 2.2 · Срок сдачи кварталом и годом (запрос Дениса 10.11): прежний свободный текст → канон «2027-Q4» / «2027» / «2025-done».
-- Год впереди — сайты берут slice(0, 4). Нераспознанные значения не трогаем (форма покажет «было: …»).
create or replace function pg_temp.dlv(v text) returns text language sql immutable as $$
  select case
    when v is null or btrim(v) = '' then null
    when btrim(v) ~* '^\d{4}(-(Q[1-4]|done))?$' then regexp_replace(btrim(v), '(?i)-q', '-Q')
    when btrim(v) ~* '^(сдан[аоы]?|done|delivered|completed)$' then 'done'
    when v ~ '(20\d{2})' then
      (regexp_match(v, '(20\d{2})'))[1] || coalesce(
        case
          when v ~* 'сдан|delivered|completed' then '-done'
          when v ~* '(^|[^A-Za-zА-Яа-я])IV\s*(кв|квартал)' then '-Q4'
          when v ~* '(^|[^A-Za-zА-Яа-я])III\s*(кв|квартал)' then '-Q3'
          when v ~* '(^|[^A-Za-zА-Яа-я])II\s*(кв|квартал)' then '-Q2'
          when v ~* '(^|[^A-Za-zА-Яа-я])I\s*(кв|квартал)' then '-Q1'
          when v ~* '([1-4])\s*(кв|квартал|Q)' then '-Q' || (regexp_match(v, '([1-4])\s*(?:кв|квартал|Q|q)'))[1]
          when v ~* 'Q\s*[1-4]' then '-Q' || (regexp_match(v, '[Qq]\s*([1-4])'))[1]
        end, '')
    else v
  end
$$;
update public.projects set delivery = pg_temp.dlv(delivery) where delivery is not null and delivery is distinct from pg_temp.dlv(delivery);
update public.buildings set delivery = pg_temp.dlv(delivery) where delivery is not null and delivery is distinct from pg_temp.dlv(delivery);
