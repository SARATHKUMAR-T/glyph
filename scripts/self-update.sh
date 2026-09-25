#!/usr/bin/env bash
# Glyph self-update script.
#
# This file is never fetched from `main` — the update badge injects a
# command that pins the URL to the exact release tag it's updating *to*
# (`raw.githubusercontent.com/.../<tag>/scripts/self-update.sh`), so a
# later change to this script on `main` can't retroactively affect a
# version that already shipped. Each release carries the script it will be
# installed by.
#
# Invoked as: sudo -v && curl -fsSL .../self-update.sh | bash -s -- <tag>
# e.g.        sudo -v && curl -fsSL .../v0.3.0/scripts/self-update.sh | bash -s -- v0.3.0
# (`sudo -v` caches credentials up front so the .deb path's `sudo dpkg -i`
# doesn't have to prompt mid-pipe; the script itself runs unprivileged.)
set -euo pipefail

REPO="SARATHKUMAR-T/glyph"
TAG="${1:?usage: self-update.sh <release-tag>}"
VERSION="${TAG#v}"

# `curl | bash` feeds this script to bash through stdin, and bash keeps
# reading the *rest of the script* from stdin as it goes. So stdin must
# never be redirected script-wide (e.g. `exec < /dev/tty`): bash would then
# wait for the remaining script body to be typed at the keyboard, and the
# update would silently hang. Commands that need the terminal (the .deb
# path's `sudo dpkg -i`) redirect `< /dev/tty` individually instead.

# Logs go to stderr: `download_and_verify` is called inside `$(...)`, and
# anything it prints to stdout would be captured as part of the file path.
log() { printf '\033[1;36m[glyph-update]\033[0m %s\n' "$1" >&2; }
fail() { printf '\033[1;31m[glyph-update]\033[0m %s\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Linux) ;;
  *) fail "Automatic updates currently support Linux only. Grab v${VERSION} manually: https://github.com/${REPO}/releases/tag/${TAG}" ;;
esac

case "$(uname -m)" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) fail "Unsupported architecture: $(uname -m)" ;;
esac

RELEASE_BASE="https://github.com/${REPO}/releases/download/${TAG}"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# Shared curl flags for release downloads. A stalled connection (under
# 1 KB/s for 30s) is aborted and retried instead of hanging silently
# forever, which looked exactly like "the update isn't doing anything".
CURL_OPTS=(--fail --location --retry 3 --retry-delay 2 --connect-timeout 15 --speed-limit 1024 --speed-time 30)

download_and_verify() {
  local asset="$1"
  local dest="$WORKDIR/$asset"
  log "Downloading ${asset}…"
  # --progress-bar draws on stderr, so it stays visible even though this
  # function runs inside $(...). A multi-MB package can take a while on a
  # slow link, and without progress it looks stuck.
  curl "${CURL_OPTS[@]}" --progress-bar -o "$dest" "${RELEASE_BASE}/${asset}" \
    || fail "Download of ${asset} failed. Check your connection and try again."
  curl "${CURL_OPTS[@]}" --silent --show-error -o "$WORKDIR/checksums.txt" "${RELEASE_BASE}/checksums.txt" \
    || fail "Download of checksums.txt failed. Check your connection and try again."

  local expected
  expected="$(grep " ${asset}\$" "$WORKDIR/checksums.txt" | awk '{print $1}')"
  [ -n "$expected" ] || fail "No checksum entry for ${asset} — refusing to install an unverified binary."

  local actual
  actual="$(sha256sum "$dest" | awk '{print $1}')"
  [ "$expected" = "$actual" ] || fail "Checksum mismatch for ${asset} (expected ${expected}, got ${actual}). Aborting."

  echo "$dest"
}

# Prefer replacing the running AppImage in place when launched from one —
# it's the frictionless, no-root path. $APPIMAGE is set by the AppImage
# runtime itself to the path of the file currently executing.
if [ -n "${APPIMAGE:-}" ] && [ -w "$(dirname "${APPIMAGE}")" ]; then
  ASSET="Glyph_${VERSION}_${ARCH}.AppImage"
  NEW_FILE="$(download_and_verify "$ASSET")"
  chmod +x "$NEW_FILE"
  mv "$NEW_FILE" "$APPIMAGE"
  log "Updated in place: ${APPIMAGE}"
  log "Open Settings → Updates → Restart Now to finish updating to v${VERSION}."
  log "(Closing the window alone won't do it — Glyph keeps running in the tray until told to quit.)"
  exit 0
fi

# .deb-based installs (Debian/Ubuntu) go through dpkg, which needs root.
# `< /dev/tty` gives sudo's password prompt (and any dpkg question) the
# keyboard without touching the stdin bash is reading this script from.
if command -v dpkg >/dev/null 2>&1 && dpkg -s glyph >/dev/null 2>&1; then
  ASSET="glyph_${VERSION}_${ARCH}.deb"
  NEW_FILE="$(download_and_verify "$ASSET")"
  log "Installing via dpkg (you may be prompted for your password)…"
  if [ -r /dev/tty ] && : 2>/dev/null < /dev/tty; then
    sudo dpkg -i "$NEW_FILE" < /dev/tty
  else
    sudo dpkg -i "$NEW_FILE"
  fi
  log "Updated to v${VERSION}. Open Settings → Updates → Restart Now to pick it up."
  log "(Closing the window alone won't do it — Glyph keeps running in the tray until told to quit.)"
  exit 0
fi

fail "Couldn't detect how Glyph was installed. Download v${VERSION} manually: https://github.com/${REPO}/releases/tag/${TAG}"
