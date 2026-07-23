#!/usr/bin/env bash
set -euo pipefail

# Reuse the established, encoding-aware credential bootstrap without printing
# any value. The restricted source file remains the single secret authority.
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
rendererRoot=/opt/source-preview
relayRoot=/opt/source-preview-proxy
unusedProxyRoot=/etc/mihomo-cloudbase
test -f "$site"
test -d "$rendererRoot/current"
test -f "$rendererRoot/current/src/ws-relay-server.js"
test -f "$rendererRoot/current/src/auth.js"
test -f "$rendererRoot/current/src/network-security.js"
test -d "$rendererRoot/current/node_modules/ws"
stamp=$(date -u +%Y%m%d-%H%M%S)
cp -a "$site" "$site.before-renderer-decommission-$stamp"
cp -a /etc/nginx/nginx.conf "/etc/nginx/nginx.conf.before-renderer-decommission-$stamp"

rm -rf "$relayRoot.next"
mkdir -p "$relayRoot.next/src" "$relayRoot.next/node_modules"
cp -a "$rendererRoot/current/src/ws-relay-server.js" "$relayRoot.next/src/"
cp -a "$rendererRoot/current/src/auth.js" "$relayRoot.next/src/"
cp -a "$rendererRoot/current/src/network-security.js" "$relayRoot.next/src/"
cp -a "$rendererRoot/current/node_modules/ws" "$relayRoot.next/node_modules/"
rm -rf "$relayRoot.previous"
if [ -d "$relayRoot" ]; then mv "$relayRoot" "$relayRoot.previous"; fi
mv "$relayRoot.next" "$relayRoot"

cat > /etc/systemd/system/source-preview-proxy.service <<'UNIT'
[Unit]
Description=Authenticated outbound WebSocket relay for CloudBase
After=network-online.target mihomo.service
Wants=network-online.target
Requires=mihomo.service

[Service]
Type=simple
User=root
EnvironmentFile=/etc/source-preview.env
Environment=RELAY_HOST=127.0.0.1
Environment=RELAY_PORT=8792
WorkingDirectory=/opt/source-preview-proxy
ExecStart=/usr/bin/node /opt/source-preview-proxy/src/ws-relay-server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl restart source-preview-proxy.service
sleep 1
test "$(systemctl is-active source-preview-proxy.service)" = active
curl --max-time 5 -fsS http://127.0.0.1:8792/health >/dev/null

sed -i '/^[[:space:]]*location = \/source-preview\/health {/,/^[[:space:]]*}$/d; /^[[:space:]]*location \/source-preview\/ {/,/^[[:space:]]*}$/d' "$site"
sed -i '/limit_req_zone .*zone=source_preview:/d' /etc/nginx/nginx.conf

systemctl disable --now source-preview.service
rm -f /etc/systemd/system/source-preview.service
if systemctl list-unit-files mihomo-cloudbase-proxy.service >/dev/null 2>&1; then
  systemctl disable --now mihomo-cloudbase-proxy.service
fi
rm -f /etc/systemd/system/mihomo-cloudbase-proxy.service
rm -f /etc/nginx/stream-conf.d/cloudbase-proxy.conf
test "$unusedProxyRoot" = /etc/mihomo-cloudbase
rm -rf -- "$unusedProxyRoot"
nginx -t
systemctl reload nginx
systemctl daemon-reload
systemctl reset-failed source-preview.service mihomo-cloudbase-proxy.service 2>/dev/null || true

test "$rendererRoot" = /opt/source-preview
rm -rf -- "$rendererRoot"
rm -rf -- "$relayRoot.previous"
rm -rf /var/lib/source-preview

test "$(systemctl is-active source-preview-proxy.service)" = active
test "$(systemctl is-active mihomo.service)" = active
if systemctl is-active --quiet source-preview.service 2>/dev/null; then exit 1; fi
if systemctl is-active --quiet mihomo-cloudbase-proxy.service 2>/dev/null; then exit 1; fi
curl --max-time 5 -fsS http://127.0.0.1:8792/health >/dev/null
curl --max-time 8 -fsS https://mrshenzf.top/source-proxy/health >/dev/null
if curl --max-time 8 -fsS https://mrshenzf.top/source-preview/health >/dev/null 2>&1; then exit 1; fi
if ss -lnt | grep -Eq '(:8791|:7891|:8443)[[:space:]]'; then exit 1; fi
printf 'renderer=removed\nrelay=active\n'
ss -lnt | awk 'NR==1 || /127.0.0.1:7890|127.0.0.1:8792|:443/'
REMOTE
)

ssh_run "$remoteCommand"
