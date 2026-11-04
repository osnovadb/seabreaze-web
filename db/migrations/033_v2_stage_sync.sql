-- v2 · Стадия клиента следует за фактами: сделки и брони. Раньше снятая или истёкшая бронь и отменённая сделка
-- оставляли клиента в «Брони» или «Платежах». Порядок воронки: … показ → бронь → KYC → договор (KYC — после брони, до договора).
create or replace function portal.sync_client_stage(cid uuid) returns text language plpgsql as $$
declare
  ord text[] := array['lead','contact','qualify','selection','fixation','viewing','booking','kyc','contract','payments','fee','support','handed'];
  cur text; deal text; booked boolean; target text;
begin
  select stage into cur from portal.clients where id = cid;
  if cur is null or cur = 'lost' or cur in ('support','handed') then return cur; end if;
  select case when bool_or(stage in ('fee_received','paid_out')) then 'fee' when bool_or(paid_pct > 0) then 'payments' else 'contract' end
    into deal from portal.deals where client_id = cid and stage <> 'cancelled' having count(*) > 0;
  select exists (select 1 from portal.bookings where client_id = cid and status in ('requested','confirmed')) into booked;
  if deal is not null then
    -- есть сделка: не ниже её стадии (выше — если команда уже перевела дальше)
    target := case when array_position(ord, cur) > array_position(ord, deal) then cur else deal end;
  elsif booked then
    -- бронь без сделки: «Бронь» или «KYC»; со стадий договора и дальше (сделка отменена) — назад в «Бронь»
    target := case when cur in ('booking','kyc') then cur else 'booking' end;
  elsif array_position(ord, cur) >= array_position(ord, 'booking') then
    -- ни брони, ни сделки: назад к показу
    target := 'viewing';
  else
    target := cur;
  end if;
  if target is distinct from cur then update portal.clients set stage = target where id = cid; end if;
  return target;
end $$;
select portal.sync_client_stage(id) from portal.clients;
