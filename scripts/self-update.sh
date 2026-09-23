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
# Invoked as: curl -fsSL .../self-update.sh | bash -s -- <tag>
# e.g.        curl -fsSL .../v0.3.0/scripts/self-update.sh | bash -s -- v0.3.0
set -euo pipefail

REPO="SARATHKUMAR-T/glyph"
TAG="${1:?usage: self-update.sh <release-tag>}"
VERSION="${TAG#v}"

# `curl | bash` hands this script's stdin to bash as the script body, so by
# default nothing here can read from the terminal — a `sudo` password
# prompt (needed for the .deb path below) would otherwise fail silently.
# Reattaching stdin to the controlling TTY fixes that, and is safe here
# because this only ever runs pasted into a real interactive terminal.
if [ -t 1 ] && [ -r /dev/tty ]; then
  exec < /dev/tty
fi

log() { printf '\033[1;36m[glyph-update]\033[0m %s\n' "$1"; }
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

download_and_verify() {
  local asset="$1"
  local dest="$WORKDIR/$asset"
  log "Downloading ${asset}…"
  curl -fsSL -o "$dest" "${RELEASE_BASE}/${asset}"
  curl -fsSL -o "$WORKDIR/checksums.txt" "${RELEASE_BASE}/checksums.txt"

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

# .deb-based installs (Debian/Ubuntu) go through dpkg, which needs root —
# this is the path `exec < /dev/tty` above exists for.
if command -v dpkg >/dev/null 2>&1 && dpkg -s glyph >/dev/null 2>&1; then
  ASSET="glyph_${VERSION}_${ARCH}.deb"
  NEW_FILE="$(download_and_verify "$ASSET")"
  log "Installing via dpkg (you may be prompted for your password)…"
  sudo dpkg -i "$NEW_FILE"
  log "Updated to v${VERSION}. Open Settings → Updates → Restart Now to pick it up."
  log "(Closing the window alone won't do it — Glyph keeps running in the tray until told to quit.)"
  exit 0
fi

fail "Couldn't detect how Glyph was installed. Download v${VERSION} manually: https://github.com/${REPO}/releases/tag/${TAG}"
