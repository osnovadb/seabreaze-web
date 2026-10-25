-- Разметка объектов: генплан (контуры домов), фасады (сетка окон с перспективой), поэтажные планы (контуры по стоякам), ориентация стояков
set search_path = portal, public;

-- Генплан: загруженное фото/рендер вместо статичной картинки
alter table genplans add column if not exists file_id uuid references files on delete set null;
alter table genplans add column if not exists updated_at timestamptz not null default now();

-- Фасад: фото стороны дома + 4 угла сетки окон (TL, TR, BR, BL в долях 0..1) + стояки слева направо + этажи
create table if not exists facades (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid not null,
  file_id     uuid not null references files on delete cascade,
  title       text not null,
  risers      text[] not null default '{}',
  floor_from  int not null default 1,
  floor_to    int not null default 1,
  quad        jsonb,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
-- Поэтажный план: план типового этажа, контуры квартир по стоякам, направление на север (градусы, 0 — вверх)
create table if not exists floor_plans (
  id          uuid primary key default gen_random_uuid(),
  building_id uuid not null,
  file_id     uuid not null references files on delete cascade,
  title       text not null,
  floor_from  int not null default 1,
  floor_to    int not null default 99,
  north_deg   int not null default 0,
  cells       jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
-- Ориентация стояка: куда выходят окна и сторона света (вид пишется и в каталог units.view_side для сайтов)
create table if not exists riser_info (
  building_id uuid not null,
  riser       text not null,
  view_side   text check (view_side in ('sea','marina','park','yard','city','mixed')),
  direction   text check (direction in ('N','NE','E','SE','S','SW','W','NW')),
  note        text,
  primary key (building_id, riser)
);
