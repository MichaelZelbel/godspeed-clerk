# A fresh Linux server with Docker, for the Clerk's machine test (test/machine/README.md):
# Ubuntu 24.04 with systemd, Docker and Compose from Ubuntu, curl. No Node.js, no Godspeed, no
# Paperless: godspeed.sh adds a stand-in Godspeed, then the test runs the Clerk's install line.
FROM ubuntu:24.04
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus ca-certificates curl iproute2 docker.io docker-compose-v2 tzdata procps less python3 \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 && systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket getty.target console-getty.service systemd-firstboot.service sys-kernel-config.mount \
 && systemctl enable docker
# Docker inside a container cannot unpack image layers with Docker 29's default image store
# ("failed to convert whiteout file"); the classic overlay2 store can. A real server needs neither.
COPY machine-docker.json /etc/docker/daemon.json
STOPSIGNAL SIGRTMIN+3
VOLUME ["/var/lib/docker"]
CMD ["/sbin/init"]
