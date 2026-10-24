#!/usr/bin/env bash
# The Clerk, an add-on for Godspeed Mission Control: the installer for macOS and Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash
#
# With options for the setup, put them after "bash -s --", for example:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-clerk/main/install.sh | bash -s -- --godspeed ~/my-mission-control
#
# Run it as the account your mission control belongs to; on a server, as root.
#
# What it does:
#   1. Finds Node.js 22 or newer: on the PATH, the Node Godspeed's own installer put in your
#      Godspeed folder, the Node that Hermes brings (~/.hermes/tools/node-*), nvm's, Homebrew's,
#      /usr/local/bin or /usr/bin. On the Docker server it keeps a copy of Godspeed's bundled
#      Node in the Clerk's private runtime folder; Godspeed's files stay as they are.
#   2. Downloads the newest release of the Clerk from GitHub (main, when there is no release yet)
#      into a temporary folder. GODSPEED_CLERK_REF=<tag or branch> picks another one;
#      GODSPEED_CLERK_TARBALL=<address or file> takes the Clerk from there instead (a mirror, a test).
#   3. Runs the Clerk's setup with your options. On a server without Paperless it asks "Install
#      Paperless now?" (yes by default) and installs it: Paperless in Docker, its HTTPS address on
#      the server's own name, your login with a second factor, a starter set of document types and
#      tags in your language, and the nightly restore copy. With --paperless <address> --user <name>
#      it connects to a Paperless you already run instead, and changes nothing in it.
#      The setup copies the program to ~/.godspeed/addons/godspeed-clerk (as root on Linux:
#      /usr/local/lib/godspeed-clerk), adds the godspeed-clerk command to ~/.godspeed/bin (as root:
#      /usr/local/bin), makes the private folder ~/.godspeed/clerk (as root: /var/lib/godspeed/clerk),
#      names the AI that will read your documents, and starts the worker: a LaunchAgent on macOS, a
#      systemd user service on a Linux desktop, a systemd service on a server. The Clerk starts paused.
#   4. Deletes the temporary folder.
#
# What it asks: whether to install Paperless, and the name you want to sign in with. For a
# Paperless you already run: your password, once, to read the account's existing token (it is not
# kept); PAPERLESS_PASSWORD in the environment answers it.
#
# What only you do: allow Google Drive access on Google's page, say yes to the folder plan, and
# sign in once on your phone.
#
# Safe to run again: it is also the update. Settings, connections and records stay as they are.
# To take it out: godspeed-clerk uninstall
#
# Everything sits inside main(), so bash has read the whole file before anything runs, even under
# "curl | bash".

main() {
  set -euo pipefail
  local repo="MichaelZelbel/godspeed-clerk"

  say() { printf '%s\n' "$*"; }
  major() { "$1" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p' | head -n 1; }

  # 1. Node.js 22 or newer.
  # Godspeed's own folder: the one its device file names, else the usual places.
  local gs="" d
  if [ -f "$HOME/.godspeed/device.env" ]; then gs="$(sed -n 's/^[[:space:]]*GODSPEED_DIR=//p' "$HOME/.godspeed/device.env" | head -n 1 | tr -d \"\')"; fi
  local wanted="${GODSPEED_MODEL_WORKSPACE:-${GODSPEED_WORKSPACE:-${GODSPEED_ROOT:-${GODSPEED_DIR:-}}}}" next="" a
  for a in "$@"; do
    if [ "$next" = godspeed ]; then wanted="$a"; next=""; continue; fi
    case "$a" in --godspeed) next=godspeed ;; --godspeed=*) wanted="${a#*=}" ;; esac
  done
  local docker_home="" id
  local homes=()
  if [ -n "$wanted" ]; then homes=("$wanted")
  else
    homes=("$gs" "$HOME/godspeed-v2" "$HOME/godspeed" /opt/godspeed-mission-control)
    if command -v docker >/dev/null 2>&1; then
      while IFS= read -r d; do [ -n "$d" ] && homes+=("$d"); done < <(docker ps --filter label=com.docker.compose.service=godspeed --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null || true)
    fi
  fi
  for d in "${homes[@]}"; do
    [ -n "$d" ] && [ -f "$d/compose.yaml" ] || continue
    id="$(docker compose -f "$d/compose.yaml" --project-directory "$d" ps -q godspeed 2>/dev/null || true)"
    if [ -n "$id" ]; then docker_home="$d"; break; fi
  done
  # An older Docker server should get the update advice before a generic missing-Node error.
  if [ -n "$docker_home" ]; then
    if ! docker compose -f "$docker_home/compose.yaml" --project-directory "$docker_home" exec -T --user hermes godspeed node --input-type=module -e '
      const r=await fetch("http://127.0.0.1:47831/health",{signal:AbortSignal.timeout(10000)});
      const m=/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/.exec((await r.json()).version||"");
      const ok=m&&(Number(m[1])>2||Number(m[1])===2&&(Number(m[2])>0||Number(m[3])>0||!m[4]||/^beta\.(\d+)$/.test(m[4])&&Number(m[4].slice(5))>=6||/^rc\.\d+$/.test(m[4])));
      if(!r.ok||!ok)process.exit(1);
    ' >/dev/null 2>&1; then
      say "Update Godspeed Mission Control to 2.0.0-beta.6 or newer, then run the Clerk install line again."
      exit 1
    fi
  fi
  local node="" c m
  for c in "$(command -v node 2>/dev/null || true)" \
           $(for d in "$gs" "$HOME/godspeed" "$HOME/godspeed-v2" /root/godspeed ${SUDO_USER:+"$(getent passwd "$SUDO_USER" | cut -d: -f6)/godspeed"}; do [ -n "$d" ] && ls -d "$d"/.godspeed/integrated-runtime/runtime/node-v*/bin/node 2>/dev/null; done | sort -r) \
           $(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -r) \
           $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r) \
           /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    m="$(major "$c")"
    if [ -n "$m" ] && [ "$m" -ge 22 ]; then node="$c"; break; fi
  done
  if [ -z "$node" ] && [ -n "$docker_home" ] && [ -f "$docker_home/.godspeed/model-host.json" ]; then
    local bundled cache tmpnode
    bundled="$(docker compose -f "$docker_home/compose.yaml" --project-directory "$docker_home" exec -T --user hermes godspeed node -e '
      let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>{const m=JSON.parse(s);if(m.format!==1||m.kind!=="godspeed-docker"||m.service!=="godspeed"||typeof m.workspace!=="string"||!m.workspace.startsWith("/"))process.exit(1);process.stdout.write(process.execPath);});
    ' < "$docker_home/.godspeed/model-host.json" 2>/dev/null || true)"
    if [ -n "$bundled" ] && [[ "$bundled" = /* ]]; then
      if [ -n "${GODSPEED_CLERK_STATE:-}" ]; then cache="$GODSPEED_CLERK_STATE/runtime"
      elif [ "$(id -u)" = 0 ] && [ "$(uname -s)" = Linux ]; then cache=/var/lib/godspeed/clerk/runtime
      else cache="$HOME/.godspeed/clerk/runtime"; fi
      mkdir -p "$cache"
      tmpnode="$cache/node.new.$$"
      id="$(docker compose -f "$docker_home/compose.yaml" --project-directory "$docker_home" ps -q godspeed)"
      if docker cp "$id:$bundled" "$tmpnode" >/dev/null 2>&1; then
        chmod 755 "$tmpnode"
        m="$(major "$tmpnode")"
        if [ -n "$m" ] && [ "$m" -ge 22 ]; then mv -f "$tmpnode" "$cache/node"; node="$cache/node"; fi
      fi
      rm -f "$tmpnode"
    fi
  fi
  if [ -z "$node" ]; then
    say "The Clerk needs Node.js 22 or newer, and none was found on this computer."
    say "Install Godspeed Mission Control first (its Hermes brings its own Node), or Node.js LTS from"
    say "https://nodejs.org (on macOS also: brew install node), then run this line again."
    exit 1
  fi

  # 2. The newest release, or main (or the tarball GODSPEED_CLERK_TARBALL names).
  local ref="${GODSPEED_CLERK_REF:-}" tarball="${GODSPEED_CLERK_TARBALL:-}"
  if [ -n "$tarball" ]; then ref="${ref:-$tarball}"
  elif [ -z "$ref" ]; then
    # The answer is JSON on one line (or several); take the value of "tag_name" either way.
    ref="$(curl -fsSL -H 'User-Agent: godspeed-clerk-installer' "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
      | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    [ -n "$ref" ] || ref="main"
  fi

  # A global, so the cleanup at the end still knows it after main() returned.
  CLERK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/godspeed-clerk-XXXXXX")"
  trap 'rm -rf "${CLERK_TMP:-}"' EXIT
  local tmp="$CLERK_TMP"
  local src="https://codeload.github.com/$repo/tar.gz/$ref"
  if [ -n "$tarball" ]; then src="$tarball"; fi
  if [ -f "$src" ]; then tar -xzf "$src" -C "$tmp" || { say "Could not unpack $src."; exit 1; }
  elif ! curl -fsSL "$src" | tar -xz -C "$tmp"; then
    say "Could not download the Clerk ($ref) from GitHub. Check the internet connection and run this line again."
    exit 1
  fi
  local pkg
  pkg="$(ls -d "$tmp"/godspeed-clerk-* 2>/dev/null | head -n 1)"
  if [ -z "$pkg" ] || [ ! -f "$pkg/bin/godspeed-clerk.mjs" ]; then
    say "The download did not hold the Clerk. Run this line again in a few minutes."
    exit 1
  fi
  say "The Clerk ($ref), with Node $("$node" --version) at $node"

  # 3. The setup. Under "curl | bash" the keyboard is not standard input (the script is), so the
  # setup questions read from the terminal itself when there is one.
  local code=0
  if [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
    "$node" "$pkg/bin/godspeed-clerk.mjs" setup "$@" < /dev/tty || code=$?
  else
    "$node" "$pkg/bin/godspeed-clerk.mjs" setup "$@" < /dev/null || code=$?
  fi
  if [ "$code" -ne 0 ]; then
    say "The setup stopped (exit $code). What it printed above says why; run this line again once that is fixed."
    exit "$code"
  fi
}

main "$@"
