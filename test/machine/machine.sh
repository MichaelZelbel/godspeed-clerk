#!/usr/bin/env bash
# Fresh machines for the Clerk's machine test (test/machine/README.md). Each machine is a container
# that runs systemd and its own Docker, on a test network with an ACME server (Pebble), so it is a
# fresh Linux server with Docker as far as the Clerk can tell, and it is thrown away whole.
#
#   machine.sh net                        the test network, the machine image and Pebble
#   machine.sh up <letter> [docker opts]  a fresh server srv-<letter>.clerk.test (a stand-in Godspeed
#                                         on it, godspeed.sh); e.g. machine.sh up d --memory 1g
#   machine.sh down <letter>              throws it away, its Docker data too
#   machine.sh sh <letter> [command...]   a root shell on it (or one command)
#   machine.sh ip <letter>
#
# Needs GODSPEED_NOTEBOOK_CHECKOUT: a checkout of the Godspeed product, for its installer's functions.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
NET=clerk-net
GW=10.89.0.1

ip_of() {
  case "$1" in
    a) echo 10.89.0.10 ;; b) echo 10.89.0.11 ;; c) echo 10.89.0.12 ;; d) echo 10.89.0.13 ;;
    [e-z]) echo "10.89.0.$(( $(printf '%d' "'$1") - 87 ))" ;;
    *) echo "machine.sh: machines are named by one letter" >&2; exit 2 ;;
  esac
}

net() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create --subnet 10.89.0.0/24 --gateway "$GW" "$NET" >/dev/null
  docker build -q -t clerk-machine:24.04 -f "$HERE/machine.Dockerfile" "$HERE" >/dev/null 2>&1
  if [ "$(docker inspect -f '{{.State.Running}}' pebble 2>/dev/null)" != true ]; then
    docker rm -f pebble >/dev/null 2>&1 || true
    docker run -d --name pebble --network "$NET" --ip 10.89.0.2 --network-alias pebble -e PEBBLE_VA_NOSLEEP=1 \
      -v "$HERE/pebble.json:/config.json:ro" ghcr.io/letsencrypt/pebble:latest -config /config.json -dnsserver 127.0.0.11:53 >/dev/null
    for _ in $(seq 1 30); do curl -sk -o /dev/null https://10.89.0.2:15000/roots/0 && break; sleep 1; done
  fi
  mkdir -p "$REPO/test/machine/.work"
  local id
  id=$(docker create ghcr.io/letsencrypt/pebble:latest)
  docker cp "$id:/test/certs/pebble.minica.pem" "$REPO/test/machine/.work/pebble.minica.pem" >/dev/null
  docker rm "$id" >/dev/null
  curl -sk https://10.89.0.2:15000/roots/0 > "$REPO/test/machine/.work/pebble-root.pem"
}

up() {
  local m=$1; shift
  local ip name c
  ip=$(ip_of "$m"); name="srv-$m.clerk.test"; c="clerk-$m"
  : "${GODSPEED_NOTEBOOK_CHECKOUT:?a checkout of the Godspeed product}"
  net
  docker rm -f "$c" >/dev/null 2>&1 || true
  docker volume rm "$c-docker" >/dev/null 2>&1 || true
  docker run -d --name "$c" --hostname "$name" --privileged --cgroupns=host \
    -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
    -v "$c-docker:/var/lib/docker" --network "$NET" --ip "$ip" --network-alias "$name" "$@" clerk-machine:24.04 >/dev/null
  for _ in $(seq 1 90); do docker exec "$c" systemctl is-active --quiet docker 2>/dev/null && break; sleep 2; done
  docker exec "$c" systemctl is-active --quiet docker
  docker exec "$c" mkdir -p /opt/clerk-test
  docker cp "$HERE/godspeed.sh" "$c:/opt/clerk-test/godspeed.sh" >/dev/null
  docker cp "$GODSPEED_NOTEBOOK_CHECKOUT/notebook/scripts/install-native-notebook.sh" "$c:/opt/clerk-test/install-native-notebook.sh" >/dev/null
  docker cp "$REPO/test/fakes/model.mjs" "$c:/opt/clerk-test/model.mjs" >/dev/null
  docker cp "$REPO/test/fakes/answers.mjs" "$c:/opt/clerk-test/answers.mjs" >/dev/null
  docker cp "$REPO/test/kit/answers.json" "$c:/opt/clerk-test/kit-answers.json" >/dev/null
  docker cp "$REPO/test/machine/.work/pebble.minica.pem" "$c:/opt/clerk-test/pebble.minica.pem" >/dev/null
  docker cp "$REPO/test/machine/.work/pebble-root.pem" "$c:/opt/clerk-test/pebble-root.pem" >/dev/null
  docker exec "$c" bash /opt/clerk-test/godspeed.sh "$name"
  echo "Machine $m: $name ($ip), fresh, with Docker and a stand-in Godspeed. A shell: test/machine/machine.sh sh $m"
}

down() {
  docker rm -f "clerk-$1" >/dev/null 2>&1 || true
  docker volume rm "clerk-$1-docker" >/dev/null 2>&1 || true
  echo "Machine $1 thrown away."
}

cmd=${1:-}; shift || true
case "$cmd" in
  net) net ;;
  up) up "$@" ;;
  down) down "$@" ;;
  ip) ip_of "$1" ;;
  sh) m=$1; shift; if [ $# -gt 0 ]; then docker exec -i "clerk-$m" bash -lc "$*"; else docker exec -it "clerk-$m" bash -l; fi ;;
  *) sed -n '2,15p' "$0"; exit 2 ;;
esac
