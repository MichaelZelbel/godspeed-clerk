#!/usr/bin/env bash
# Disposable fresh public install, one server at a time. Run only after beta.6 is public.
set -euo pipefail
kind=${1:?docker or native}; name=${2:?disposable machine name}; ip=${3:?clerk-net IP}
case "$kind" in docker|native) ;; *) exit 2;; esac
case "$name" in clerk-b6-*) ;; *) echo "Use a clerk-b6- disposable name"; exit 2;; esac
: "${PUBLIC_BETA6_READY:?set to the public runtime commit after release readback}"
base=/root/clerk-release-05
mkdir -p "$base/$name"; chmod 700 "$base" "$base/$name"
if docker inspect "$name" >/dev/null 2>&1; then echo "Name already exists; choose a new fresh machine"; exit 2; fi
for old in $(docker ps --filter name=clerk-b6- --format '{{.Names}}'); do echo "Another release machine runs: $old"; exit 2; done
docker run -d --name "$name" --hostname "$name.clerk.test" --memory 4g --memory-swap 4g --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock -v "$name-data:/var/lib/docker" --network clerk-net --ip "$ip" --network-alias "$name.clerk.test" clerk-machine:24.04 >/dev/null
for i in $(seq 1 90); do docker exec "$name" systemctl is-active --quiet docker 2>/dev/null && break; sleep 2; done
docker exec "$name" systemctl is-active --quiet docker
if [ "$kind" = docker ] && [ -n "${PUBLIC_IMAGE_CACHE:-}" ]; then
  docker exec -i "$name" docker load < "$PUBLIC_IMAGE_CACHE" > "$base/$name/image-cache.log"
fi
host="notebook-$kind.localhost"
docker exec "$name" sh -c "printf '127.0.0.1 $host\n' >> /etc/hosts"
if [ "$kind" = docker ]; then url=https://godspeedmissioncontrol.com/server; else url=https://godspeedmissioncontrol.com/install; fi
docker exec "$name" curl -A 'Clerk selftest fresh-install' -fsSL "$url" -o /root/install-public-godspeed.sh
# Network accommodation only: reject a truly stalled smart-HTTP download and retry the same installer.
docker exec "$name" sh -c 'command -v git >/dev/null && { git config --global http.version HTTP/1.1; git config --global http.lowSpeedTime 30; git config --global http.lowSpeedLimit 1; } || true'
set +e
docker exec -e GIT_CONFIG_COUNT=3 -e GIT_CONFIG_KEY_0=http.version -e GIT_CONFIG_VALUE_0=HTTP/1.1 -e GIT_CONFIG_KEY_1=http.lowSpeedTime -e GIT_CONFIG_VALUE_1=30 -e GIT_CONFIG_KEY_2=http.lowSpeedLimit -e GIT_CONFIG_VALUE_2=1 -e GODSPEED_HOST="$host" -e DO_NOT_TRACK=1 "$name" bash -c 'umask 077; bash /root/install-public-godspeed.sh > /root/godspeed-install.log 2>&1'
code=$?
set -e
printf '%s\n' "$code" > "$base/$name/product-exit.txt"
docker cp "$name:/root/godspeed-install.log" "$base/$name/product-private.log" >/dev/null
if [ "$code" != 0 ]; then echo "Public Godspeed install exit $code; private log $base/$name/product-private.log"; exit "$code"; fi
echo "Fresh public $kind installed. Next: verify actual private health .6, configure made-up normal provider/profile, run unchanged Clerk README line."
