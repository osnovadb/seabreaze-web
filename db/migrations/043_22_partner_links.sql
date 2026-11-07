-- 2.2 · §6 П8 Инструменты партнёра: личная ссылка (страница под брендом агентства с формой → кандидат партнёра) и белый фид для его сайта.
-- Цены — как на наших сайтах: «цена от» или без цены; точные — только в подборке.
create table if not exists portal.partner_links (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references portal.users on delete cascade,
  code        text not null unique,
  title       text,
  project_ids uuid[] not null default '{}',
  lang        text not null default 'de',
  price_mode  text not null default 'from' check (price_mode in ('from','none')),
  active      boolean not null default true,
  leads       int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists partner_links_user on portal.partner_links (user_id);
