#!/bin/sh
# Выкладка портала на ams: исходники → /opt/ge-portal/src, сборка на сервере, релиз в /opt/ge-portal/current.
# Миграции: npm run db:migrate локально (база общая, через туннель на 5433). Сид на сервере не запускаем.
set -e
cd "$(dirname "$0")/.."
H=root@72.56.89.30
rsync -az --delete --exclude node_modules --exclude .next --exclude '.env*' --exclude dev-uploads --exclude dev-files --exclude .git --exclude TEST-ACCESS.md --exclude '*.tsbuildinfo' ./ $H:/opt/ge-portal/src/
ssh $H 'set -e; cd /opt/ge-portal/src && npm ci --no-audit --no-fund >/dev/null && set -a && . /opt/ge-portal/portal.env && set +a && NODE_ENV=production npx next build >/tmp/ge-portal-build.log 2>&1 || { tail -30 /tmp/ge-portal-build.log; exit 1; }
cd /opt/ge-portal; rm -rf next-new; mkdir next-new; cp -a src/.next/standalone/. next-new/; mkdir -p next-new/.next
cp -a src/.next/static next-new/.next/static; cp -a src/public next-new/public; chown -R www-data:www-data next-new
[ -d current ] && mv current prev-$(date +%s); mv next-new current; ls -dt prev-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
systemctl restart ge-portal; sleep 2; systemctl is-active ge-portal'
for p in /login /apply /; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://ge-portal.pdna.pro$p"; done
