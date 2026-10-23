#!/usr/bin/env bash
# Runs inside a fresh machine, as root: a stand-in for a server where Godspeed Mission Control is
# installed, as far as the Clerk sees it, made with the product's own installer functions where
# they exist:
#   - the Godspeed folder /root/godspeed, with the Node.js Godspeed's installer keeps in it
#     (install_node: nodejs.org, checked against its published checksums);
#   - the notebook's web address: Godspeed's own Caddy on ports 80 and 443 (godspeed-https.service,
#     start_own_caddy), its certificate from the test network's ACME server (Pebble) instead of
#     Let's Encrypt, which is the only change made to what Godspeed writes;
#   - Godspeed's model connection: a stand-in with the kit's recorded answers;
#   - the assistant's Telegram settings (~/.hermes/.env), made up.
# The notebook itself runs on the test host, so it outlives this machine as a person's notebook
# outlives a server.
#
#   godspeed.sh <the server's name>      files from the test host in /opt/clerk-test
set -euo pipefail
NAME=${1:?give the server name}
T=/opt/clerk-test
root=/root/godspeed
state="$root/.godspeed/integrated-runtime"
mkdir -p "$root/rules" "$state" "$root/.godspeed"
printf '# A made-up Godspeed folder\n\nThe stand-in for Godspeed Mission Control on a fresh machine of the Clerk'"'"'s machine test.\n' > "$root/AGENTS.md"
export HOME=/root GODSPEED_INSTALLER_FUNCTIONS_ONLY=1
# shellcheck source=/dev/null
source "$T/install-native-notebook.sh"
node=$(install_node)
echo "Godspeed's Node.js: $node ($("$node" --version))"

# The model connection: recorded answers (the Clerk's own test stand-in).
cat > "$root/.godspeed/model.mjs" <<'EOF'
// A stand-in for Godspeed's model connection on the Clerk's test machines: recorded answers.
process.env.GODSPEED_CLERK_FAKE_ANSWERS ||= "/opt/clerk-test/kit-answers.json";
await import("/opt/clerk-test/model.mjs");
EOF

# The assistant's Telegram (made up; the test's pretend Telegram API answers).
mkdir -p /root/.hermes
printf 'TELEGRAM_BOT_TOKEN=999:made-up-for-the-machine-test\nTELEGRAM_HOME_CHANNEL=1001\n' > /root/.hermes/.env
chmod 600 /root/.hermes/.env

# The test network's certificate authority, trusted like a public one.
cp "$T/pebble-root.pem" /usr/local/share/ca-certificates/clerk-test-pebble.crt
update-ca-certificates >/dev/null 2>&1

# The notebook's web address, the way Godspeed's installer makes it.
service_user=root service_group=root GODSPEED_WEB_PORT=47833
start_own_caddy "$NAME"
sed -i 's|^\tadmin off$|\tadmin off\n\tacme_ca https://pebble:14000/dir\n\tacme_ca_root /opt/clerk-test/pebble.minica.pem|' "$state/https/Caddyfile"
systemctl restart godspeed-https.service
code=000
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$NAME/" || true)
  [ "$code" != 000 ] && break
  sleep 2
done
echo "Godspeed's web address https://$NAME: HTTP $code over a certificate this machine trusts (the notebook itself runs elsewhere)"
[ "$code" != 000 ]
