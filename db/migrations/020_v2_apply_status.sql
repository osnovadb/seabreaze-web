-- v2 · М13: заявитель видит статус своей заявки по ссылке с токеном (без входа)
set search_path = portal, public;
alter table agent_applications add column if not exists status_token text;
update agent_applications set status_token = encode(gen_random_bytes(12), 'hex') where status_token is null;
create unique index if not exists agent_applications_token on agent_applications (status_token);
