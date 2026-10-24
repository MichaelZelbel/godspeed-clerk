# Beta.5 first-install walkthrough, 24 October 2026

Release held. No Clerk program changes were made before this walkthrough. The normal Docker
server and a fresh native installation both need Godspeed product fixes before the promised
first-install journey can pass. The Clerk remains 0.4.0, private and unreleased.

The prerequisite check found **Godspeed Mission Control 2.0.0-beta.5** as GitHub Latest:
<https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-24-1>.
Both installed notebooks report `2.0.0-beta.5`. Their source is
`b81160c56f22266ab96c6a89b30df53f0365fe9e`; the Docker image is
`ghcr.io/michaelzelbel/godspeed-mission-control@sha256:cfcc97ee120ceeaa8ccd9df1be8bd0467a8d21664054523a26b6fd39ee017fc2`,
whose revision label names that source. The Clerk tarball is the unchanged `16cd1d0` checkout.

## What ran

Used the existing `clerk-machines` WSL test bed and its `clerk-machine:24.04` Ubuntu image,
with systemd and an independent Docker daemon per disposable server. The fresh servers were
`clerk-public-docker` and `clerk-public-native`, on the existing `clerk-net` network. Their Docker
data uses dedicated volumes `clerk-public-docker-data` and `clerk-public-native-data` on the
test bed's disk. No earlier Godspeed folder or stand-in Godspeed was installed in either machine.
The old machine test's outside notebook and fake model launcher were not used.

The guide's actual commands were downloaded from the website and run unchanged. The only
installation overrides were the test names and disabling the optional installation count:

```bash
# Docker server, first:
curl -fsSL https://godspeedmissioncontrol.com/server -o /root/install-public-godspeed.sh
GODSPEED_HOST=localhost DO_NOT_TRACK=1 bash /root/install-public-godspeed.sh

# Native server, separately:
curl -fsSL https://godspeedmissioncontrol.com/install -o /root/install-public-godspeed.sh
GODSPEED_HOST=srv-native.localhost DO_NOT_TRACK=1 bash /root/install-public-godspeed.sh
```

The native installer installed its normal Git, Node, Hermes, source checkout, built notebook,
background services and HTTPS front. Its Hermes checkout is
`bf0203a794a07aac3ff764972ab9087baa4e4f4e`.

While the Clerk repository is private, the README line used a local tarball made with
`git archive --format=tar.gz --prefix=godspeed-clerk-baseline/ HEAD`. The unchanged `install.sh`
and tarball were copied into each machine:

```bash
GODSPEED_CLERK_TARBALL=/root/clerk.tar.gz bash /root/install-clerk.sh
```

For native HTTPS, `/etc/hosts` maps `srv-native.localhost` to `127.0.0.1`. Caddy's generated test
root is trusted for the Node HTTPS probe through `NODE_EXTRA_CA_CERTS`. These are local CA
certificates, not Pebble or publicly issued certificates. No public CA or hosting firewall is
claimed tested. The HTTPS probe returns Paperless's expected unauthenticated HTTP 401 once this
test name and CA are supplied.

After the test bed restart replaced the native machine's generated `/etc/hosts`, the mapping
was restored. The initial Clerk process was waiting for that test address; only that process
was stopped, then the same installer resumed with its test CA explicitly trusted:

```bash
NODE_EXTRA_CA_CERTS=$HOME/godspeed-v2/.godspeed/integrated-runtime/https/caddy/pki/authorities/local/root.crt \
  GODSPEED_CLERK_TARBALL=/root/clerk.tar.gz bash /root/install-clerk.sh
```

The native Clerk installer finished with **exit 0**, Paperless `3.3.3`, installation stage `done`
and a successful HTTPS address check. It then printed:

```text
AI: not approved yet (Godspeed has no configured model connection). Nothing will be sorted until then: godspeed-clerk ai approve
```

Its status is paused with no approved AI. Installing Paperless is therefore not a passing
sort-and-file journey. No phone-style letter or test-drive filing is claimed completed.

## Failures found before code changes

| Path | Live result | Consequence |
| --- | --- | --- |
| Docker README line | `The Clerk needs Node.js 22 or newer, and none was found on this computer.` | The default server puts Node inside Godspeed's container, not on its host. The line stops before setup. |
| Docker, probe with its own bundled Node copied to the host | `Paperless was not installed, because: ... no Caddy answers on ports 80 and 443.` | Godspeed's existing, working Caddy is in a container. Clerk host-only discovery cannot find it. |
| Docker workspace discovery | Default discovery returns `null`; explicitly naming `/opt/godspeed-mission-control` finds the host model launcher. | The normal command cannot find this server installation automatically. The actual notebook workspace remains inside the container. |
| Docker notebook, direct probe inside the real container | `POST http://127.0.0.1:47831/api/query` returns HTTP 401, `SIGN_IN_REQUIRED`. | Docker has no separate private notebook door. A plain `docker exec` relay cannot use Clerk's existing note, collection and add-on deadline APIs. This needs a Godspeed product fix. |
| Native configured model connection | The released workspace model launcher exits 1: `The connected Godspeed assistant Python runtime was not found`. | Fresh Hermes now uses a package-manager shim layout. Godspeed's add-on model resolver cannot find that runtime. Sorting cannot start through the required `godspeed-model` route. This needs a Godspeed product fix. |
| Native web-address registration | Clerk creates `.../integrated-runtime/https/godspeed-clerk.caddy` and adds its own import to Godspeed's Caddyfile, despite the installed `/etc/caddy/godspeed-addons/*.caddy` import. | Clerk still needs the D-356 add-on folder migration and removal of its earlier import. |

The Node copy was a diagnostic probe only, not an installer change or a workaround shipped to
users. The real Docker notebook was used for its API probe; no port was exposed and its login
was not bypassed. An installation assistant's bearer key is accepted at `/mcp`, but does not
authorize `/api/query` or `/api/functions/addon-deadlines`. The existing MCP tool set has no
equivalent add-on deadline operation. Owner sessions were not manufactured and storage imports
were not used as an alternative API.

The native model failure was repeated after the supported Hermes commands successfully saved
a made-up custom connection:

```bash
hermes config set model.provider custom
hermes config set model.default clerk-test
hermes config set model.base_url http://127.0.0.1:48904/v1
node ~/godspeed-v2/.godspeed/model.mjs --check --workspace ~/godspeed-v2
```

The descriptor is verified and points to `~/.local/bin/hermes`, with `~/.hermes` as its home.
That executable is a shell shim for `~/.hermes/hermes-agent/.hermes/bin/hermes`; the new layout
has no adjacent Python or old `.venv`. Godspeed's released `hermesHelper` fails before it reads
the selected provider or attempts a request. This is distinct from an unconfigured AI account.

## Brief for the next release attempt

1. Release the Godspeed product fixes first: a private Docker notebook door and support for the
   current native Hermes runtime layout. Preparing product pull requests does not release Godspeed.
2. Walk both public installs again against the actual release that contains those fixes.
3. In Clerk, add the minimum Godspeed version check before any Paperless or service changes.
   Reject unsupported Docker versions before the generic missing Node or Caddy messages.
4. Complete Docker host Node, installation/workspace and HTTPS discovery in Clerk. Use the
   supported private notebook door without exposing it on the network. Then verify the actual
   model command, assistant Telegram home and profile time zone after normal first setup.
   The present Docker probes cannot establish Telegram or time-zone behavior until this works.
5. On native beta.5 or newer, use the installed add-on web-address folder and remove Clerk's
   earlier import and site in the same successful migration.
6. Only after both fresh paths pass, upload an invented letter the way the phone app does,
   prove it is sorted and filed in a test drive, and run the one independent README review.
7. Audit every new commit, then publish 0.5.0, the guide and the production update within the
   original approval. No release or update has been made by this walkthrough.

Do not build Docker support against an unreleased, assumed product contract. Do not add a new
AI route or change the user's provider. A native-only release has not been approved, and the
fresh native model failure makes that an unsuitable substitute in this run anyway.

## Receipts and recovery

The downloaded native installer hash is
`be6d0adc49ca5cdacadba225d1fbc5d4d2a103510c7217fbde8f11562b3bb73a`.
The downloaded Docker installer hash is
`926e7b57c35a1c7007a5e36b22b8ed204a58fc24ad998afaf1731a2eb5f73e15`.
The unchanged Clerk installer hash is
`e4331d850c75e85c9870821d5267321c0808d15ac30404eadb133f41392cc459`;
its baseline tarball hash is `3c450cec37e96991a3c8153041941b95eb8288f622bda4d9654ce513653f1bbf`.

Full outputs remain in the disposable machines as root-only `/root/godspeed-install.log`,
`/root/clerk-before.log` and, on native, `/root/godspeed-install-resume.log` and
`/root/clerk-after-ca.log`. They contain test
login material and must not be copied into this repository. Diagnostic scripts and the original
tarball remain in the repository's ignored `test/machine/.work/` folder. The exact released
source used for inspection is in the WSL test bed at `/root/clerk-public-release/product`.

The first native attempt encountered a slow GitHub smart-HTTP clone. It resumed with Git's
HTTP/1.1 and low-speed timeout settings; the same public installer completed normally. WSL also
restarted unexpectedly once, interrupting both disposable containers with exit 255 and no
OOM flag. Both were restarted, and the unchanged native installer resumed. These were test
environment interruptions, not Clerk findings. All heavy images and downloads stayed on the
existing test bed. No paid runner or rented server was used.
