-- v2 · KYC с проверкой офисом (хвост ТЗ 1.0, поднят раньше: без KYC сделка не идёт в договор)
-- Документы: паспорт, подтверждение адреса, происхождение средств. Данные — гражданство, налоговое резидентство, PEP.
set search_path = portal, public;
alter table client_documents drop constraint if exists client_documents_kind_check;
alter table client_documents add constraint client_documents_kind_check check (kind in ('passport','address','funds','kyc','booking','contract','payment','other'));
alter table clients add column if not exists kyc_citizenship text;
alter table clients add column if not exists kyc_tax_residence text;
alter table clients add column if not exists kyc_pep boolean;
alter table clients add column if not exists kyc_note text;
alter table clients add column if not exists kyc_submitted_at timestamptz;
alter table clients add column if not exists kyc_checked_by uuid references users;
alter table clients add column if not exists kyc_checked_at timestamptz;
