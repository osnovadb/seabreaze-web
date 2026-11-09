#!/bin/sh
# QA 2.2 — полный прогон на ams: юнит-тесты, сквозные наборы против QA-экземпляра (:3043), обмен с Bitrix24 (:3044, с уборкой).
# sh tests/qa22/run.sh [--no-b24]    итог — tests/qa22/out/summary.txt
cd /opt/ge-portal22/src || exit 1
mkdir -p tests/qa22/out
exec 9>/root/ge-qa22.lock; flock -w 1800 9 || { echo "другой прогон QA идёт"; exit 1; }
set -a; . /opt/ge-portal22/qa.env; set +a
node --test tests/unit22/pure.test.mjs > tests/qa22/out/unit.tap 2>&1
docker exec -i seabreeze-postgres-1 psql -q -U seabreeze -d seabreeze_qa22 < tests/qa22/cleanup.sql > tests/qa22/out/cleanup.log 2>&1
node --test --test-concurrency=1 $(ls tests/qa22/[0-9][0-9]_*.test.mjs | grep -v 11_b24) > tests/qa22/out/e2e.tap 2>&1
if [ "$1" != "--no-b24" ]; then
  set -a; . /opt/ge-portal22/qa-b24.env; set +a; export QA_URL=http://127.0.0.1:3044
  node --test --test-concurrency=1 tests/qa22/11_b24.test.mjs > tests/qa22/out/b24.tap 2>&1
fi
{
  date -u +"QA 2.2 · %Y-%m-%d %H:%M UTC"
  for f in unit e2e b24; do [ -f tests/qa22/out/$f.tap ] || continue
    echo "== $f: $(grep -E '^# pass' tests/qa22/out/$f.tap | tail -1 | sed 's/# //'), $(grep -E '^# fail' tests/qa22/out/$f.tap | tail -1 | sed 's/# //')"
    grep -A12 '^not ok' tests/qa22/out/$f.tap | grep -E '^not ok|^  error' | sed 's/^/   /'
  done
  grep -E '^# i18n' tests/qa22/out/e2e.tap | head -1
} > tests/qa22/out/summary.txt
cat tests/qa22/out/summary.txt
