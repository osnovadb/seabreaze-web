-- v2 · М7: план оплаты у квартиры в подборке — по нему строится график в ссылке и PDF клиента
set search_path = portal, public;
alter table selection_items add column if not exists plan_id uuid;
