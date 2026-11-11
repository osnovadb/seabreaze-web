-- Денис 11.11: несколько ракурсов генплана («покрутить здание»): основной вид — image/polygons/marks, его название — title;
-- дополнительные — views: [{ title, image, file_id, polygons }] (контуры в долях картинки, как у основного)
alter table portal.genplans add column if not exists title text;
alter table portal.genplans add column if not exists views jsonb not null default '[]'::jsonb;
