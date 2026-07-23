#!/usr/bin/env bash
set -euo pipefail

eval "$(sed -n '4,8p' /mnt/d/miniprogram/wiki/secrets/deploy-source-preview.sh)"

ssh_run() {
  sshpass -e ssh \
    -o StrictHostKeyChecking=accept-new \
    -o ConnectTimeout=10 \
    -o ServerAliveInterval=5 \
    -o ServerAliveCountMax=2 \
    -o PreferredAuthentications=password \
    -o PubkeyAuthentication=no \
    -o NumberOfPasswordPrompts=1 \
    -p "$port" \
    root@"$host" "$@"
}

remoteCommand=$(cat <<'REMOTE'
set -eu
site=/etc/nginx/sites-enabled/web-20250819-https
mkdir -p /etc/nginx/backups
for backup in /etc/nginx/sites-enabled/*.before-renderer-decommission-*; do
  if [ -e "$backup" ]; then mv "$backup" /etc/nginx/backups/; fi
done
cat > /etc/nginx/snippets/source-preview-retired.conf <<'NGINX'
location ^~ /source-preview/ {
    return 410;
}
NGINX
if ! grep -q 'source-preview-retired.conf' "$site"; then
  sed -i '/include \/etc\/nginx\/snippets\/source-proxy-location.conf;/i\    include /etc/nginx/snippets/source-preview-retired.conf;' "$site"
fi
nginx -t
systemctl reload nginx
sleep 1

test -d /opt/source-preview-proxy
test ! -e /opt/source-preview
test ! -e /etc/mihomo-cloudbase
test ! -e /etc/systemd/system/source-preview.service
test ! -e /etc/systemd/system/mihomo-cloudbase-proxy.service
test "$(systemctl is-active source-preview-proxy.service)" = active
test "$(systemctl is-active mihomo.service)" = active
if systemctl is-active --quiet source-preview.service 2>/dev/null; then exit 1; fi
if systemctl is-active --quiet mihomo-cloudbase-proxy.service 2>/dev/null; then exit 1; fi
curl --max-time 5 -fsS http://127.0.0.1:8792/health >/dev/null
curl --max-time 8 -fsS https://mrshenzf.top/source-proxy/health >/dev/null
test "$(curl --max-time 8 -sS -o /dev/null -w '%{http_code}' https://mrshenzf.top/source-preview/health)" = 410
if ss -lnt | grep -Eq '(:8791|:7891|:8443)[[:space:]]'; then exit 1; fi
printf 'renderer=removed\nrelay=active\nretiredRoute=410\n'
ss -lnt | awk 'NR==1 || /127.0.0.1:7890|127.0.0.1:8792|:443/'
REMOTE
)

ssh_run "$remoteCommand"
