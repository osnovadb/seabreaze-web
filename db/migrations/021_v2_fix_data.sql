-- v2 · исправления по QA: старые ручные «KYC пройден» без документов и анкеты сбрасываются — их нужно пройти заново
set search_path = portal, public;
update clients cl set kyc_status = 'none', kyc_note = 'Старый ручной статус без документов — пройдите KYC заново'
where kyc_status in ('passed','pending') and kyc_checked_at is null
  and (kyc_citizenship is null or not exists (select 1 from client_documents d where d.client_id = cl.id and d.kind = 'passport'));
