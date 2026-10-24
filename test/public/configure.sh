#!/usr/bin/env bash
# Normal first setup against the fresh public runtime. Made-up credentials only.
set -euo pipefail
kind=${1:?docker or native}; outer=${2:?disposable server name}
case "$outer" in clerk-b6-*) ;; *) echo 'Use only a clerk-b6- test server'; exit 2;; esac
here=$(cd "$(dirname "$0")" && pwd)
docker cp "$here/configure.mjs" "$outer:/root/clerk-test-configure.mjs" >/dev/null
if [ "$kind" = docker ]; then
  docker exec "$outer" docker cp /root/clerk-test-configure.mjs godspeed-mission-control-godspeed-1:/tmp/clerk-test-configure.mjs >/dev/null
  docker exec "$outer" bash -lc 'invite=$(grep -oE "invite=[A-Za-z0-9_-]+" /root/godspeed-install.log | tail -1 | cut -d= -f2); docker exec --user hermes -e SETUP_INVITE="$invite" godspeed-mission-control-godspeed-1 node /tmp/clerk-test-configure.mjs /opt/data/full-candidate/workspace 47832 47831'
elif [ "$kind" = native ]; then
  docker exec "$outer" bash -lc 'invite=$(grep -oE "invite=[A-Za-z0-9_-]+" /root/godspeed-install.log | tail -1 | cut -d= -f2); node=$(find /root/godspeed-v2/.godspeed/integrated-runtime/runtime -path "*/bin/node" -type f | head -1); SETUP_INVITE="$invite" "$node" /root/clerk-test-configure.mjs /root/godspeed-v2 47831 47833'
else
  echo 'Choose docker or native'; exit 2
fi
