# -*- coding: utf-8 -*-
"""Настройка Bitrix24 по ТЗ 2.2 (разделы 3 и 12): воронки, стадии, статусы лидов, поля, смарт-процесс Event.

Идемпотентно: существующее находит по имени или коду и не дублирует.
Вебхук берётся из ~/.config/getsestate/b24-webhook (или B24_WEBHOOK) и никуда не печатается.

  python3 -I scripts/b24setup/setup.py plan    # показать, что будет сделано
  python3 -I scripts/b24setup/setup.py apply   # применить
"""
import json, os, sys, time, urllib.request, urllib.error

WH = (os.environ.get('B24_WEBHOOK') or open(os.path.expanduser('~/.config/getsestate/b24-webhook')).read()).strip().rstrip('/') + '/'
APPLY = len(sys.argv) > 1 and sys.argv[1] == 'apply'
LOG = []


def call(method, params=None):
    req = urllib.request.Request(WH + method + '.json', data=json.dumps(params or {}).encode(),
                                 headers={'Content-Type': 'application/json'})
    for attempt in range(5):
        try:
            r = json.load(urllib.request.urlopen(req, timeout=60))
        except urllib.error.HTTPError as e:
            body = e.read().decode() or '{}'
            try:
                r = json.loads(body)
            except Exception:
                r = {'error': str(e.code), 'error_description': body[:200]}
        if r.get('error') == 'QUERY_LIMIT_EXCEEDED':
            time.sleep(2 + attempt * 2)
            continue
        time.sleep(0.5)
        return r
    return r


def do(desc, method, params):
    LOG.append(desc)
    print(('+ ' if APPLY else '~ ') + desc)
    if not APPLY:
        return None
    r = call(method, params)
    if 'error' in r:
        print('  ! ' + r['error'] + ': ' + str(r.get('error_description'))[:200])
        return None
    return r.get('result')


# ---------- ТЗ 2.2 ----------
MARKETS = ['DE', 'IL', 'Global']
SALES = ['Selection', 'Developer registration', 'Reservation request', 'Reserved', 'KYC', 'SPA approval', 'SPA signed', 'Payments']
PIPELINES = []
for m in MARKETS:
    PIPELINES.append(('Sales ' + m, SALES, 'Won', 'Lost', []))
for m in MARKETS:
    PIPELINES.append(('Agencies ' + m, ['New application', 'Contacted', 'Documents', 'Agreement sent', 'Agreement signed', 'Access granted', 'First client'], 'Active', 'Rejected', ['Inactive', 'Blocked']))
for m in MARKETS:
    PIPELINES.append(('Sub-agents ' + m, ['New application', 'Contacted', 'Documents', 'Agreement sent', 'Agreement signed', 'Access granted', 'First client'], 'Active', 'Rejected', ['Inactive', 'Blocked']))
for m in MARKETS:
    PIPELINES.append(('Partner clients ' + m, SALES, 'Won', 'Lost', []))
PIPELINES.append(('Installments', ['Paying', 'Overdue'], 'Paid in full', 'Terminated', []))
PIPELINES.append(('Aftercare', ['Construction', 'Handover', 'Ownership registered', 'Services'], 'Done', 'Cancelled', []))

LEAD_STATUSES = [  # (STATUS_ID системный или новый, имя, семантика)
    ('NEW', 'New', None), ('GE_CANDIDATE', 'Candidate', None), ('IN_PROCESS', 'In progress', None),
    ('CONVERTED', 'Qualified', 'S'), ('GE_PARTNER_CLIENT', 'Partner client', 'F'), ('GE_PARTNER_REQ', 'Partner request', 'F'),
    ('GE_DUPLICATE', 'Duplicate', 'F'), ('JUNK', 'Junk', 'F'),
]
SOURCES = [('GE_WEBSITE', 'Website form'), ('GE_LANDING', 'Landing page'), ('GE_PARTNER', 'Partner'), ('GE_REFERRER', 'Referrer'),
           ('GE_EVENT', 'Event'), ('GE_SMARTCAT', 'Developer smart catalog'), ('GE_OFFICE', 'Office visit'), ('GE_PORTALS', 'Property portals')]

LOST = ['Price', 'Financing', 'No trust', 'Not ready', 'No contact', 'Chose other project', 'Chose other agency',
        'Developer client', 'Registered with other agency', 'Compliance', 'Other']
SEGMENTS = ['DE · Diaspora', 'DE · Investor', 'DE · Second home', 'DE · Relocation', 'DACH · Russian-speaking', 'DACH · German-speaking',
            'DACH · Turkish-speaking', 'IL · Russian-speaking', 'IL · From Azerbaijan', 'IL · Hebrew-speaking investor', 'IL · Plan B']
LANGS = ['RU', 'EN', 'DE', 'HE', 'AZ']

E = lambda *v: ('enumeration', list(v))
S, N, D, B, DT, U = ('string', None), ('double', None), ('date', None), ('boolean', None), ('datetime', None), ('url', None)

COMMON_LEAD = [
    ('GE_MARKET', 'Market', E(*MARKETS)), ('GE_COUNTRY', 'Country', S), ('GE_LANGUAGE', 'Language', E(*LANGS)),
    ('GE_PARTNER', 'Partner', S), ('GE_AGENCY', 'Agency', S), ('GE_AGENT', 'Agent', S), ('GE_REFERRER', 'Referrer', S),
    ('GE_EVENT', 'Event', S), ('GE_EVENT_ATT', 'Event attendance', E('Registered', 'Attended', 'No-show')),
    ('GE_GCLID', 'gclid', S), ('GE_FBCLID', 'fbclid', S), ('GE_TTCLID', 'ttclid', S),
    ('GE_FIRST_TOUCH', 'First touch', S), ('GE_LAST_TOUCH', 'Last touch', S), ('GE_LANDING', 'Landing page', S), ('GE_VISITOR', 'Visitor ID', S),
    ('GE_CHECK', 'Check status', E('Checking', 'Free', 'Team', 'Partner', 'Partner candidate', 'Duplicate')),
    ('GE_DATA_CONSENT', 'Data consent', DT), ('GE_MKT_CONSENT', 'Marketing consent', DT), ('GE_SEGMENT', 'Segment', E(*SEGMENTS)),
]
CONTACT = [
    ('GE_CLIENT_ID', 'Portal client ID', S), ('GE_OWNER_TYPE', 'Owner type', E('team', 'partner', 'referrer')), ('GE_PROTECTED', 'Protected until', D),
    ('GE_PREV_PARTNER', 'Previous partner', S), ('GE_CITIZEN', 'Citizenship', S), ('GE_TAXRES', 'Tax residence', S),
    ('GE_CHANNEL', 'Preferred channel', E('Phone', 'WhatsApp', 'Telegram', 'E-mail')), ('GE_LANGUAGES', 'Languages', S),
    ('GE_DNC', 'Do not contact', B), ('GE_KYC', 'KYC status', E('Not requested', 'Requested', 'On review', 'Passed', 'Rejected')),
    ('GE_EVENT', 'Event', S), ('GE_EVENT_ATT', 'Event attendance', E('Registered', 'Attended', 'No-show')),
    ('GE_SEGMENT', 'Segment', E(*SEGMENTS)), ('GE_NURTURE', 'Nurture', E('Price', 'No trust', 'Not ready', 'No contact', 'Quarterly')),
    ('GE_DATA_CONSENT', 'Data consent', DT), ('GE_MKT_CONSENT', 'Marketing consent', DT),
]
DEAL = [
    ('GE_DEAL_ID', 'Portal deal ID', S), ('GE_PROJECT', 'Project', S), ('GE_MAIN_UNIT', 'Main unit', S), ('GE_UNITS', 'Units of interest', S),
    ('GE_LIST_PRICE', 'List price', N), ('GE_FINAL_PRICE', 'Final price', N), ('GE_DISCOUNT', 'Discount %', N), ('GE_PLAN', 'Payment plan', S),
    ('GE_CURRENCY', 'Currency', E('USD', 'EUR', 'ILS', 'AZN')),
    ('GE_RES_STATUS', 'Reservation status', E('Hold', 'Requested', 'Queued', 'Reserved', 'Declined', 'Released', 'Expired')),
    ('GE_RES_UNTIL', 'Reserved until', D), ('GE_DEV_RES_NO', 'Developer reservation No.', S), ('GE_DEV_REGS', 'Developer registrations', S),
    ('GE_DEAL_MARKET', 'Deal market', E(*MARKETS)), ('GE_AGENCY', 'Agency', S), ('GE_AGENT', 'Agent', S), ('GE_REFERRER', 'Referrer', S),
    ('GE_ESCORT', 'Escort in Baku', S), ('GE_TRIP', 'Trip date', D), ('GE_TRIP_STATUS', 'Trip status', E('Requested', 'Confirmed', 'Done', 'No-show')),
    ('GE_SIGNING', 'Signing', E('In person', 'Remote', 'Power of attorney')), ('GE_COBUYERS', 'Co-buyers', S), ('GE_BUYER_CO', 'Buyer company', S),
    ('GE_DISPUTE', 'Ownership dispute', B), ('GE_SEL_LINK', 'Selection link', U), ('GE_PORTAL_LINK', 'Portal link', U),
    ('GE_LOST', 'Lost reason', E(*LOST)),
    # Installments / Aftercare
    ('GE_SCHEDULE', 'Schedule', S), ('GE_NEXT_PAY', 'Next payment', D), ('GE_OVERDUE', 'Payment overdue', B), ('GE_PAID_PCT', 'Paid %', N),
    ('GE_DEV_DELAY', 'Developer delay', B), ('GE_CLAWBACK', 'Clawback', B), ('GE_RESALE', 'Resale', B),
    ('GE_RESIDENCE', 'Residence permit', E('Not needed', 'Interested', 'In progress', 'Done')),
    ('GE_RENTAL', 'Rental management', E('Not needed', 'Interested', 'Active')),
    # Agencies / Sub-agents
    ('GE_PARTNER_TYPE', 'Partner type', E('Agency', 'Sub-agent', 'Referrer')), ('GE_PARTNER_FORM', 'Partner form', E('Company', 'Sole trader', 'Individual')),
    ('GE_OUR_ENTITY', 'Our entity', E('GetsEstate GmbH (DE)', 'GetsEstate IL Ltd (IL)', 'Caspian (AZ)')), ('GE_RATE', 'Rate', S),
    ('GE_AGREEMENT', 'Agreement form', E('Paper', 'Offer', 'E-sign')), ('GE_DOCS', 'Documents link', U), ('GE_PARTNER_ID', 'Portal partner ID', S),
]


def field_payload(code, label, t):
    typ, items = t
    f = {'FIELD_NAME': code, 'USER_TYPE_ID': typ, 'XML_ID': code, 'EDIT_FORM_LABEL': label, 'LIST_COLUMN_LABEL': label,
         'LIST_FILTER_LABEL': label, 'SHOW_FILTER': 'Y', 'SETTINGS': {}}
    if typ == 'enumeration':
        f['LIST'] = [{'VALUE': v, 'SORT': (i + 1) * 10} for i, v in enumerate(items)]
    return f


def ensure_fields(entity, fields):
    existing = call('crm.%s.userfield.list' % entity, {'filter': {}}).get('result', [])
    have = {f['FIELD_NAME'] for f in existing}
    for code, label, t in fields:
        name = 'UF_CRM_' + code
        if name in have:
            continue
        do('поле %s · %s (%s)' % (entity, label, t[0]), 'crm.%s.userfield.add' % entity, {'fields': field_payload(code, label, t)})


def stages_entity(cat_id):
    return 'DEAL_STAGE' if cat_id == 0 else 'DEAL_STAGE_%d' % cat_id


def ensure_stages(cat_id, process, won, lost, extra_fail):
    ent = stages_entity(cat_id)
    cur = call('crm.status.list', {'filter': {'ENTITY_ID': ent}, 'order': {'SORT': 'ASC'}}).get('result', [])
    names = [s['NAME'] for s in cur]
    want = process + [won, lost] + extra_fail
    if names == want or (APPLY is False and set(want) <= set(names)):
        return
    sysmap = {s['STATUS_ID']: s for s in cur}
    pref = '' if cat_id == 0 else 'C%d:' % cat_id
    first = next((s for s in cur if s.get('SYSTEM') == 'Y' and s['STATUS_ID'] in (pref + 'NEW',)), None)
    wons = next((s for s in cur if s['STATUS_ID'] == pref + 'WON'), None)
    loses = next((s for s in cur if s['STATUS_ID'] == pref + 'LOSE'), None)
    # системные: первая, WON, LOSE — переименовываем; остальные дефолтные удаляем; недостающие добавляем
    if first and first['NAME'] != process[0]:
        do('воронка %d: первая стадия → %s' % (cat_id, process[0]), 'crm.status.update', {'id': first['ID'], 'fields': {'NAME': process[0], 'SORT': 10}})
    if wons and wons['NAME'] != won:
        do('воронка %d: успех → %s' % (cat_id, won), 'crm.status.update', {'id': wons['ID'], 'fields': {'NAME': won, 'SORT': 900}})
    if loses and loses['NAME'] != lost:
        do('воронка %d: провал → %s' % (cat_id, lost), 'crm.status.update', {'id': loses['ID'], 'fields': {'NAME': lost, 'SORT': 910}})
    keep_ids = {x['ID'] for x in (first, wons, loses) if x}
    wanted_rest = process[1:] + extra_fail
    for s in cur:
        if s['ID'] in keep_ids:
            continue
        if s['NAME'] in wanted_rest:
            continue
        do('воронка %d: удалить стадию по умолчанию %s' % (cat_id, s['NAME']), 'crm.status.delete', {'id': s['ID'], 'params': {'FORCED': 'Y'}})
    have_names = {s['NAME'] for s in cur}
    for i, name in enumerate(process[1:]):
        if name in have_names:
            continue
        do('воронка %d: стадия %s' % (cat_id, name), 'crm.status.add',
           {'fields': {'ENTITY_ID': ent, 'STATUS_ID': pref + 'GE%02d' % (i + 2), 'NAME': name, 'SORT': (i + 2) * 10, 'SEMANTICS': ''}})
    for j, name in enumerate(extra_fail):
        if name in have_names:
            continue
        do('воронка %d: стадия-выход %s' % (cat_id, name), 'crm.status.add',
           {'fields': {'ENTITY_ID': ent, 'STATUS_ID': pref + 'GEF%d' % (j + 1), 'NAME': name, 'SORT': 920 + j * 10, 'SEMANTICS': 'F'}})


def main():
    print('Режим:', 'ПРИМЕНЕНИЕ' if APPLY else 'план (ничего не меняю)')
    # 1. воронки сделок
    cats = call('crm.category.list', {'entityTypeId': 2}).get('result', {}).get('categories', [])
    by_name = {c['name']: c['id'] for c in cats}
    if 'Sales DE' not in by_name and 'Default pipeline' in by_name:
        do('воронка по умолчанию → Sales DE', 'crm.category.update', {'entityTypeId': 2, 'id': 0, 'fields': {'name': 'Sales DE', 'sort': 10}})
        by_name['Sales DE'] = 0
    for i, (name, *_rest) in enumerate(PIPELINES):
        if name in by_name:
            continue
        r = do('воронка ' + name, 'crm.category.add', {'entityTypeId': 2, 'fields': {'name': name, 'sort': (i + 1) * 10}})
        if r:
            by_name[name] = r['category']['id']
    # 2. стадии
    for name, process, won, lost, extra in PIPELINES:
        if name in by_name:
            ensure_stages(by_name[name], process, won, lost, extra)
    # 3. статусы лидов и источники
    cur = {s['STATUS_ID']: s for s in call('crm.status.list', {'filter': {'ENTITY_ID': 'STATUS'}}).get('result', [])}
    for i, (sid, name, sem) in enumerate(LEAD_STATUSES):
        if sid in cur:
            if cur[sid]['NAME'] != name or int(cur[sid]['SORT']) != (i + 1) * 10:
                do('статус лида %s → %s' % (sid, name), 'crm.status.update', {'id': cur[sid]['ID'], 'fields': {'NAME': name, 'SORT': (i + 1) * 10}})
        else:
            do('статус лида ' + name, 'crm.status.add', {'fields': {'ENTITY_ID': 'STATUS', 'STATUS_ID': sid, 'NAME': name, 'SORT': (i + 1) * 10, 'SEMANTICS': sem or ''}})
    for s in cur.values():
        if s['STATUS_ID'] not in {x[0] for x in LEAD_STATUSES} and s.get('SYSTEM') != 'Y':
            do('удалить статус лида по умолчанию ' + s['NAME'], 'crm.status.delete', {'id': s['ID']})
    src = {s['STATUS_ID'] for s in call('crm.status.list', {'filter': {'ENTITY_ID': 'SOURCE'}}).get('result', [])}
    for i, (sid, name) in enumerate(SOURCES):
        if sid not in src:
            do('источник ' + name, 'crm.status.add', {'fields': {'ENTITY_ID': 'SOURCE', 'STATUS_ID': sid, 'NAME': name, 'SORT': 200 + i * 10}})
    # 4. поля
    ensure_fields('lead', COMMON_LEAD)
    ensure_fields('contact', CONTACT)
    ensure_fields('deal', DEAL)
    # 5. смарт-процесс Event
    types = call('crm.type.list', {}).get('result', {}).get('types', [])
    if not any(t.get('title') == 'Event' for t in types):
        do('смарт-процесс Event', 'crm.type.add', {'fields': {'title': 'Event', 'code': 'ge_event', 'isStagesEnabled': 'Y', 'isCategoriesEnabled': 'N',
                                                          'isClientEnabled': 'Y', 'isLinkWithProductsEnabled': 'N', 'isUseInUserfieldEnabled': 'Y',
                                                          'relations': {'parent': [], 'child': [{'entityTypeId': 1}, {'entityTypeId': 3}]}}})
    types = call('crm.type.list', {}).get('result', {}).get('types', [])
    ev = next((t for t in types if t.get('title') == 'Event'), None)
    if ev:
        et = ev['entityTypeId']
        cats = call('crm.category.list', {'entityTypeId': et}).get('result', {}).get('categories', [])
        if cats:
            cid = cats[0]['id']
            ent = 'DYNAMIC_%d_STAGE_%d' % (et, cid)
            cur = call('crm.status.list', {'filter': {'ENTITY_ID': ent}, 'order': {'SORT': 'ASC'}}).get('result', [])
            want = ['Planned', 'Registration open', 'Held', 'Follow-up done', 'Cancelled']
            if [s['NAME'] for s in cur] != want:
                proc = [s for s in cur if s.get('SEMANTICS') not in ('S', 'F')]
                succ = next((s for s in cur if s.get('SEMANTICS') == 'S'), None)
                fail = next((s for s in cur if s.get('SEMANTICS') == 'F'), None)
                if proc:
                    do('Event: первая стадия → Planned', 'crm.status.update', {'id': proc[0]['ID'], 'fields': {'NAME': 'Planned', 'SORT': 10}})
                for s in proc[1:]:
                    do('Event: удалить стадию ' + s['NAME'], 'crm.status.delete', {'id': s['ID'], 'params': {'FORCED': 'Y'}})
                for i, n in enumerate(['Registration open', 'Held']):
                    do('Event: стадия ' + n, 'crm.status.add', {'fields': {'ENTITY_ID': ent, 'STATUS_ID': 'DT%d_%d:GE%d' % (et, cid, i + 2), 'NAME': n, 'SORT': (i + 2) * 10}})
                if succ:
                    do('Event: успех → Follow-up done', 'crm.status.update', {'id': succ['ID'], 'fields': {'NAME': 'Follow-up done', 'SORT': 900}})
                if fail:
                    do('Event: провал → Cancelled', 'crm.status.update', {'id': fail['ID'], 'fields': {'NAME': 'Cancelled', 'SORT': 910}})
    print('Итого шагов: %d' % len(LOG))


if __name__ == '__main__':
    main()
