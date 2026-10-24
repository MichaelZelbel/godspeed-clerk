# Beta.6 first-install brief, 24 October 2026

This brief was frozen before Clerk program changes. The Clerk remains unchanged at 0.4.0 for
both runs. Godspeed Mission Control 2.0.0-beta.6 is now a normal public Latest release:
<https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-24-2>.

The public release readback passed before either install began. Runtime source:
`9390da492a0035a41b0eb02584234e269bca6dc8`; immutable installation pin:
`78ea790d766073bf77059fadf4d1c340b022059d`; Docker image:
`ghcr.io/michaelzelbel/godspeed-mission-control@sha256:70a07e63bad57ee9cf114a86be3261db533191af28927453a81d5ea8fc330291`.
The Docker revision label and the native installed version receipt match that runtime source.

## Actual first installs

Fresh Ubuntu 24.04 servers in the existing K-backed `clerk-machines` bed, with systemd and a
separate Docker daemon each: `clerk-b6-docker-baseline` first, then
`clerk-b6-native-baseline`. Only one server ran at a time; each was limited to 4 GB. Neither
received an earlier Godspeed workspace or application data. The old machine test's stand-in
Godspeed and outside notebook were not used.

```bash
# Docker, first; native, separately after stopping the Docker server:
curl -A 'Clerk selftest fresh-install' -fsSL https://godspeedmissioncontrol.com/server -o /root/install-public-godspeed.sh
GODSPEED_HOST=notebook-docker.localhost DO_NOT_TRACK=1 bash /root/install-public-godspeed.sh

curl -A 'Clerk selftest fresh-install' -fsSL https://godspeedmissioncontrol.com/install -o /root/install-public-godspeed.sh
GODSPEED_HOST=notebook-native.localhost DO_NOT_TRACK=1 bash /root/install-public-godspeed.sh
```

Both public installers finished with exit 0 and real notebook health version `2.0.0-beta.6`.
The selftest header and optional-count setting avoid counting test installations. Git was given
HTTP/1.1 and a low-speed timeout through its process environment; neither installer was edited.

For each real verified assistant, the normal Hermes configuration commands selected the made-up
`custom` provider, `clerk-test` model and a local fake OpenAI-compatible HTTP endpoint. A fake
key and fake Telegram bot/chat were saved in that assistant's actual home. The normal installed
private invitation created the made-up notebook owner. The notebook's actual record API saved
that owner's time zone as `Europe/Berlin`. No credentials or record files were imported.

Both released model helpers passed describe **and an actual tools-free inference request** to
that local HTTP endpoint. The real private query and add-on deadline APIs worked. The public
notebook query still returned HTTP 401. Docker used its new private loopback port 47832 inside
the actual Godspeed container; native used its normal private port 47831. No private port was
published and no outside notebook or replacement model command was supplied.

The unchanged Clerk README installer was downloaded from a local test mirror, with the unchanged
`16cd1d0` program tarball, while the repository was private:

```bash
GODSPEED_CLERK_TARBALL=http://10.89.0.1:48903/clerk.tar.gz bash /root/install-clerk.sh
```

The Docker run finished with **exit 1**, because there is no host Node. The native run finished
with **exit 0**: Paperless 3.3.3, installation stage `done`, trusted HTTPS address checked,
approved custom AI, real notebook reachable, assistant Telegram found and Paperless time zone
`Europe/Berlin`. Installation remains paused until the normal Drive and folder-plan setup.
No completed letter journey is claimed by this baseline.

## Frozen failures and required changes

| Path | Observed result | Clerk change required |
| --- | --- | --- |
| Docker README line | `The Clerk needs Node.js 22 or newer, and none was found on this computer.` | Provision a Clerk-owned host Node from the installed Godspeed runtime. |
| Docker workspace | Default discovery is `null`; explicitly naming `/opt/godspeed-mission-control` works. Its real model command succeeds. | Find the standard Docker installation automatically, including its host model launcher. |
| Docker HTTPS | Old `findFront` returns `none`; the existing Godspeed Caddy serves CA-trusted HTTPS health successfully. With a diagnostic copy of Godspeed's own Node, old setup stops at `no Caddy answers on ports 80 and 443`. | Discover the real Docker HTTPS front and give Paperless its own address using the same certificate storage. |
| Docker notebook | Old default notebook probe fails; direct requests to the real container's private 47832 work. | Relay only the required notebook requests through Docker exec to that loopback door. |
| Docker assistant Telegram | Old discovery fails despite the fake token and chat in the real verified assistant home. | Read that assistant's own settings through the supported Docker installation. |
| Docker time zone | The configured real notebook has `Europe/Berlin`, but Clerk's old notebook adapter cannot reach it. | Use the same private relay for the profile time zone before creating Paperless. |
| Native Caddy registration | Both supported wildcard imports exist, but Clerk adds its old individual import and writes its site beside Godspeed's Caddyfile. | Use `/etc/caddy/godspeed-addons/godspeed-clerk.caddy` and migrate the old Clerk import/site after a successful update. |
| Minimum version, required by the release brief | Clerk has no Godspeed prerequisite version gate. Beta.5 lacks the now-tested Docker door and native model fix. | Require Godspeed Mission Control 2.0.0-beta.6 or newer before Paperless or service changes, with one clear update sentence. |

These are the implementation scope. The Godspeed product gaps from the earlier beta.5 run are
fixed in the actual public beta.6 and passed both fresh configurations. No additional AI route,
login bypass or durability work is part of this batch.

## Test accommodations and private receipts

The `.localhost` names map to loopback inside each server. HTTPS uses each actual Godspeed
Caddy's local CA, whose root is explicitly trusted by the test client and the installer's Node
probe. Docker's normal public compose and Caddy configuration were kept unchanged. Its Caddy
image is pinned `caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d`,
with its normal named certificate volume mounted at `/data`. Its trusted HTTPS health was
checked. Public ACME issuance and a hosting provider's firewall are not claimed tested.

Downloaded image layers were cached without application data: the exact public Godspeed image,
and the existing pinned Paperless 3.3.3 image. Registry pin checks and the public installers still
ran normally. After image extraction, the test bed's own Linux page cache was reclaimed before
the capped server's Clerk resource check; free memory then measured 3.3 GB on Docker and 3.5 GB
on native. No user apps or system configuration were changed. The copied Docker Node was used
only for the old-code diagnostic probe, not installed on its PATH.

Root-only receipts remain under `/root/clerk-release-05/<machine>/` on the WSL bed, with full
installer output inside each disposable server at `/root/godspeed-install.log` and
`/root/clerk-baseline.log`. Those logs include made-up login material and must stay private.
The K test harness and image caches are under `K:\clerk-test\clerk-release-0.5`. The safe final
journey evidence and reviewer instructions will be added after the fixed fresh paths pass.