#!/usr/bin/env bash
# Run inside one fresh server after its real Godspeed first setup is complete.
set -euo pipefail
kind=${1:?docker or native}; phase=${2:-baseline}
base=/var/lib/godspeed/clerk
install -d -m700 "$base"
cat > "$base/service.env" <<'ENV'
GODSPEED_CLERK_TEST=1
GODSPEED_CLERK_TODAY=2026-10-24
GODSPEED_CLERK_DRIVE_API=http://10.89.0.1:48900
GODSPEED_CLERK_GOOGLE_AUTH_URL=http://10.89.0.1:48900/o/oauth2/v2/auth
GODSPEED_CLERK_GOOGLE_TOKEN_URL=http://10.89.0.1:48900/token
GODSPEED_CLERK_TELEGRAM_API=http://10.89.0.1:48902
ENV
if [ "$kind" = native ]; then
  ca=/root/godspeed-v2/.godspeed/integrated-runtime/https/caddy/pki/authorities/local/root.crt
else
  ca=/root/godspeed-test-root.crt
  docker cp godspeed-mission-control-https-1:/data/caddy/pki/authorities/local/root.crt "$ca" >/dev/null
fi
test -f "$ca"
printf 'NODE_EXTRA_CA_CERTS=%s\n' "$ca" >> "$base/service.env"
chmod600() { chmod 600 "$1"; }
chmod600 "$base/service.env"
sed 's/^/export /' "$base/service.env" > /etc/profile.d/clerk-test.sh
. /etc/profile.d/clerk-test.sh
curl -fsSL http://10.89.0.1:48903/install.sh -o /root/install-clerk.sh
set +e
GODSPEED_CLERK_TARBALL=http://10.89.0.1:48903/clerk.tar.gz bash /root/install-clerk.sh > /root/clerk-$phase.log 2>&1
code=$?
set -e
chmod600 /root/clerk-$phase.log
printf '%s\n' "$code" > /root/clerk-$phase-exit.txt
printf 'Clerk README line exit %s. Full private log: /root/clerk-%s.log\n' "$code" "$phase"
exit "$code"