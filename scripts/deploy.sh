#!/bin/sh
# Выкладка портала на ams: исходники → /opt/<app>/src, сборка на сервере, релиз в /opt/<app>/current.
# STAND=v2 — стенд разработки v2 (ge-portal2.pdna.pro, база seabreeze_v2); по умолчанию — тест v1 (ge-portal.pdna.pro).
# Миграции: npm run db:migrate локально (через туннель на 5433, база — из .env.local). Сид на сервере не запускаем.
set -e
cd "$(dirname "$0")/.."
H=root@72.56.89.30
if [ "$STAND" = v2 ]; then APP=ge-portal2; DOMAIN=ge-portal2.pdna.pro; else APP=ge-portal; DOMAIN=ge-portal.pdna.pro; fi
rsync -az --delete --exclude node_modules --exclude .next --exclude '.env*' --exclude dev-uploads --exclude dev-files --exclude .git --exclude TEST-ACCESS.md --exclude '*.tsbuildinfo' ./ $H:/opt/$APP/src/
ssh $H "set -e; cd /opt/$APP/src && npm ci --no-audit --no-fund >/dev/null && set -a && . /opt/$APP/portal.env && set +a && NODE_ENV=production npx next build >/tmp/$APP-build.log 2>&1 || { tail -30 /tmp/$APP-build.log; exit 1; }
cd /opt/$APP; rm -rf next-new; mkdir next-new; cp -a src/.next/standalone/. next-new/; mkdir -p next-new/.next
cp -a src/.next/static next-new/.next/static; cp -a src/public next-new/public; chown -R www-data:www-data next-new
[ -d current ] && mv current prev-\$(date +%s); mv next-new current; ls -dt prev-* 2>/dev/null | tail -n +3 | xargs -r rm -rf
systemctl restart $APP; sleep 2; systemctl is-active $APP"
for p in /login /apply /; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://$DOMAIN$p"; done
