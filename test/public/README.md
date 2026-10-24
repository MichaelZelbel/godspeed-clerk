# Fresh public-server install review

This is the single release review runbook for Clerk 0.5.0 and public Godspeed Mission Control
2.0.0-beta.6. Read the Clerk README as a new user and follow its order. These helpers provide
made-up outside services and local certificates; they do not replace Godspeed, its notebook,
its model command or Paperless. Report a verdict for both server types, including any install
step that needs information the README does not give.

Use the existing `clerk-machines` WSL bed on K, `clerk-machine:24.04` stock Ubuntu/systemd/Docker
image and `clerk-net` network. Do not run `test/machine/machine.sh up`: that older test installs a
stand-in Godspeed. Run only one disposable server at a time, with the helpers' 4 GB limit. Keep a
foreground WSL command alive during the test, since systemd services alone do not keep WSL alive.
Do not shut down WSL or change the user's apps or WSL configuration.

All commands below run as root in that WSL bed, from the Clerk checkout. `node` below means its
existing `/opt/node22/bin/node`. Use new names and IPs if those shown already exist; `fresh.sh`
refuses an existing name. No production server is involved.

## Services and the private candidate archive

```bash
cd /mnt/c/godspeed/dev/godspeed-clerk
export WORK=/mnt/k/clerk-test/clerk-review-0.5
mkdir -p "$WORK"
python3 test/kit/render.py test/kit/rendered # existing test bed has Pillow and the kit font
git archive --format=tar.gz --prefix=godspeed-clerk-review/ HEAD > "$WORK/clerk.tar.gz"
CLERK_TARBALL="$WORK/clerk.tar.gz" /opt/node22/bin/node test/public/services.mjs
```

Leave that foreground process running while using another tool session for the server. It serves
only the existing made-up kit: Google Drive and its normal OAuth consent redirect on 48900,
Telegram on 48902, the exact checkout's `install.sh` and candidate tarball on 48903, and recorded
OpenAI-compatible HTTP model answers on 48904. Port 48905 reports safe file/message counts. It
starts an empty pretend Drive each time, with the kit's folders and untouched sample files.

No real Google app, account, token, AI key or Telegram bot is used. The helpers make a fake Google
Desktop app JSON, use `drive connect --client-file`, follow consent and finish its callback. The
real installed assistant is configured through Hermes's normal `config set` commands and its
own `.env`, with only made-up settings. The installed owner invitation is consumed through the
normal account setup API, and the actual notebook API saves a made-up profile time zone.

## Docker, first

```bash
export PUBLIC_BETA6_READY=9390da492a0035a41b0eb02584234e269bca6dc8
# Optional downloaded-image cache only; no workspace or application data:
export PUBLIC_IMAGE_CACHE=/mnt/k/clerk-test/clerk-release-0.5/godspeed-beta6-cache.tar
bash test/public/fresh.sh docker clerk-b6-docker-review 10.89.0.34
bash test/public/configure.sh docker clerk-b6-docker-review

# Optional existing pinned Paperless image cache; normal registry checks still run:
docker exec -i clerk-b6-docker-review docker load < /mnt/k/clerk-test/clerk-release-0.5/paperless-3.3.3-cache.tar
# Reclaim this test bed's image-extraction page cache before the capped memory check:
sync
echo 3 > /proc/sys/vm/drop_caches

docker cp test/public/readme.sh clerk-b6-docker-review:/root/readme-clerk.sh
docker exec clerk-b6-docker-review bash /root/readme-clerk.sh docker review
docker cp clerk-b6-docker-review:/root/godspeed-test-root.crt "$WORK/docker-root.crt"
/opt/node22/bin/node test/public/phone.mjs clerk-b6-docker-review docker 10.89.0.34 "$WORK/docker-root.crt" "$WORK/docker-evidence.json"
docker stop clerk-b6-docker-review
```

`fresh.sh` downloads the actual website `/server` installer with a selftest User-Agent and runs it
unchanged. Its only Godspeed settings are the test `.localhost` name and `DO_NOT_TRACK=1`; Git's
HTTP/1.1/low-speed settings are a network accommodation. It installs no Godspeed from a checkout
or snapshot. The normal released image, source revision and notebook health must be beta.6.
`configure.sh` proves an actual request through the released model helper and tests that the
private door works while the public door still requires sign-in.

`readme.sh` runs the exact checkout's install script with the private tarball override. It adds
only fake outside-service endpoints/date and trust for the actual Godspeed Caddy's local root.
It leaves full output private at `/root/clerk-review.log` and returns the installer's real exit.
The phone helper follows README Drive, folder plan, resume and **phone** steps, signs in over
trusted HTTPS with password and TOTP, uploads `water-invoice.pdf` as a multipart phone scan, waits
for real OCR, and checks the filed document, actual notebook note/collection/deadline, discovered
Telegram delivery and active status. It verifies that Godspeed and Paperless present the same
leaf certificate.

No `GODSPEED_MODEL_COMMAND` or `GODSPEED_CLERK_NOTEBOOK` override is allowed. Docker's private
47832 door stays loopback-only inside Godspeed; the Clerk reaches it through Docker exec.

## Native, separately

Stop only the foreground test-service process you started, then start it again with the same
archive command so its pretend Drive is empty. The Docker server must remain stopped.

```bash
unset PUBLIC_IMAGE_CACHE
bash test/public/fresh.sh native clerk-b6-native-review 10.89.0.35
bash test/public/configure.sh native clerk-b6-native-review
docker exec -i clerk-b6-native-review docker load < /mnt/k/clerk-test/clerk-release-0.5/paperless-3.3.3-cache.tar
sync
echo 3 > /proc/sys/vm/drop_caches

docker cp test/public/readme.sh clerk-b6-native-review:/root/readme-clerk.sh
docker exec clerk-b6-native-review bash /root/readme-clerk.sh native review
docker cp clerk-b6-native-review:/root/godspeed-v2/.godspeed/integrated-runtime/https/caddy/pki/authorities/local/root.crt "$WORK/native-root.crt"
/opt/node22/bin/node test/public/phone.mjs clerk-b6-native-review native 10.89.0.35 "$WORK/native-root.crt" "$WORK/native-evidence.json"
docker stop clerk-b6-native-review
```

This uses the actual website `/install` path, which installs Node, Hermes, the native released
notebook, background services and Caddy. The private notebook port is the normal 47831. Also
check that `/etc/caddy/godspeed-addons/godspeed-clerk.caddy` exists and there is no individual
legacy Clerk import/site beside Godspeed's Caddyfile. The separate actual 0.4-to-0.5 migration
receipt is release evidence; it is not a substitute for this fresh native review.

## Evidence and limits

The JSON evidence files contain only made-up document facts, counts, test hostnames, versions and
certificate fingerprints. Full installer logs and login files stay root-only in the disposable
servers; do not commit them. Each server's public-install exit and private log also remain under
`/root/clerk-release-05/<server>/` on the bed. Keep the two safe JSON files and the review verdict.

The HTTPS test deliberately uses each unchanged Godspeed Caddy's local CA, with explicit root
trust and local DNS mapping. It proves valid TLS and reuse of the same certificate/storage. It
does not claim public ACME issuance or an external hosting firewall was tested. Do not disable
certificate verification, expose a private API, change production or use paid services/runners.