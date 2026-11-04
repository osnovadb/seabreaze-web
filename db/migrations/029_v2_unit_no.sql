-- v2 · Номер квартиры для показа: «D-808» из корпуса D и номера 808; если номер уже с префиксом корпуса (BRABUS «A-0305») — как есть.
-- Одна функция вместо склеек по всему порталу (у BRABUS external_id пустой, и склейка давала «-A-0305»).
create or replace function portal.unit_no(ext text, num text) returns text language sql immutable as $$
  select case when num ~* '^[A-ZА-Я]{1,3}-' or coalesce(ext, '') = '' then upper(num) else upper(ext || '-' || num) end
$$;
