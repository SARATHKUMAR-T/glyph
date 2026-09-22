#!/usr/bin/env bash
#
# Build Glyph from source for an Ubuntu 20.04 (focal) host.
#
# The published release binary is built on a newer Ubuntu and therefore requires
# a newer GLIBC than focal's 2.31. This script builds Glyph inside a focal
# container instead, so the binary links against GLIBC 2.31 and WebKitGTK 4.0 --
# both already present on a focal desktop. Nothing is installed on the host, and
# no sudo is needed.
#
# See docs/building-on-ubuntu-20.04.md for why the shims and crate patches exist.
#
# Usage:
#   scripts/build-local.sh              # build, then install into ~/.local
#   scripts/build-local.sh --no-install # build only
#   scripts/build-local.sh --rebuild-image
#
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="glyph-builder:focal"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/glyph-build"
PREFIX="${PREFIX:-$HOME/.local}"

# Crates that must be patched to build against WebKitGTK 2.38 (see docker/patches).
# Each entry is <crate>:<version> and needs docker/patches/<crate>-<version>.patch.
PATCHED_CRATES=(
  "wry:0.55.1"
  "tauri-runtime:2.11.3"
  "tauri-runtime-wry:2.11.4"
  "tauri:2.11.5"
)

DO_INSTALL=1
REBUILD_IMAGE=0
for arg in "$@"; do
  case "$arg" in
    --no-install)     DO_INSTALL=0 ;;
    --rebuild-image)  REBUILD_IMAGE=1 ;;
    -h|--help)        sed -n '2,18p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "cannot talk to the docker daemon" >&2; exit 1; }

# The patches are written against exact versions; refuse to apply them silently
# to a different one.
for entry in "${PATCHED_CRATES[@]}"; do
  crate="${entry%%:*}"; want="${entry##*:}"
  have="$(awk -v c="name = \"$crate\"" '$0==c{f=1;next} f&&/^version = /{gsub(/[",]/,"");print $3;exit}' \
          "$REPO/src-tauri/Cargo.lock")"
  if [ "$have" != "$want" ]; then
    echo "error: docker/patches targets $crate $want, but Cargo.lock pins ${have:-none}." >&2
    echo "       Re-create docker/patches/$crate-*.patch for $crate ${have:-?} before building." >&2
    exit 1
  fi
  [ -f "$REPO/docker/patches/$crate-$want.patch" ] || {
    echo "error: missing docker/patches/$crate-$want.patch" >&2; exit 1; }
done

if [ "$REBUILD_IMAGE" = 1 ] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "==> building $IMAGE"
  docker build -f "$REPO/docker/Dockerfile.focal-builder" -t "$IMAGE" "$REPO"
fi

mkdir -p "$CACHE/cargo" "$CACHE/target" "$CACHE/vendor" "$CACHE/out" "$CACHE/npm"

echo "==> building Glyph (frontend + rust release binary)"
docker run --rm -t \
  --user "$(id -u):$(id -g)" \
  -v "$REPO:/src" \
  -v "$CACHE/cargo:/cargo" \
  -v "$CACHE/target:/build/target" \
  -v "$CACHE/vendor:/vendor" \
  -v "$CACHE/out:/out" \
  -v "$CACHE/npm:/npm" \
  -e CARGO_HOME=/cargo \
  -e CARGO_TARGET_DIR=/build/target \
  -e HOME=/tmp/home \
  -e npm_config_cache=/npm \
  -e PATCHED_CRATES="${PATCHED_CRATES[*]}" \
  -w /src \
  "$IMAGE" bash -euo pipefail -c '
    mkdir -p /tmp/home

    echo "--> frontend"
    # Reinstall only when the lockfile changed; npm ci wipes node_modules and
    # re-downloads everything otherwise.
    NPM_STAMP=node_modules/.glyph-build-stamp
    NPM_WANT="$(md5sum package-lock.json 2>/dev/null | cut -d" " -f1)"
    if [ ! -d node_modules ] || [ ! -f "$NPM_STAMP" ] || [ "$(cat "$NPM_STAMP")" != "$NPM_WANT" ]; then
      if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
      echo "$NPM_WANT" > "$NPM_STAMP"
    else
      echo "    node_modules up to date"
    fi
    npm run build

    echo "--> vendoring patched crates"
    PATCH_ARGS=""
    for entry in $PATCHED_CRATES; do
      crate="${entry%%:*}"; ver="${entry##*:}"
      PATCH="/src/docker/patches/$crate-$ver.patch"
      STAMP="/vendor/$crate.stamp"
      WANT="$(md5sum "$PATCH" | cut -d" " -f1)"
      if [ ! -d "/vendor/$crate" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$WANT" ]; then
        CRATE_FILE="/vendor/$crate-$ver.crate"
        [ -f "$CRATE_FILE" ] || curl -fsSL "https://static.crates.io/crates/$crate/$crate-$ver.crate" -o "$CRATE_FILE"
        rm -rf "/vendor/$crate" "/vendor/$crate-$ver"
        tar -xzf "$CRATE_FILE" -C /vendor
        mv "/vendor/$crate-$ver" "/vendor/$crate"
        patch -p1 -d "/vendor/$crate" < "$PATCH"
        echo "$WANT" > "$STAMP"
      else
        echo "    $crate $ver (up to date)"
      fi
      PATCH_ARGS="$PATCH_ARGS$crate = { path = \"/vendor/$crate\" }\n"
    done

    # Build out of tree so the repository Cargo.lock is not rewritten by [patch].
    echo "--> assembling build root"
    rm -rf /build/src-tauri /build/dist /build/.cargo
    mkdir -p /build/src-tauri /build/dist /build/.cargo
    tar -C /src/src-tauri --exclude=./target -cf - . | tar -C /build/src-tauri -xf -
    tar -C /src/dist -cf - . | tar -C /build/dist -xf -
    {
      echo "[patch.crates-io]"
      printf "%b" "$PATCH_ARGS"
      echo "[build]"
      echo "rustflags = [\"-C\", \"link-arg=$GLYPH_COMPAT_LIB\"]"
    } > /build/.cargo/config.toml

    # The tauri build script sets dev = !custom-protocol, and in dev mode the
    # webview loads build.devUrl instead of the bundled frontend. The Tauri CLI
    # turns this feature on for a release build; plain cargo has to be told.
    echo "--> cargo build --release"
    cd /build/src-tauri
    cargo build --release --features tauri/custom-protocol

    cp "$CARGO_TARGET_DIR/release/nothing-terminal" /out/glyph
  '

BIN="$CACHE/out/glyph"
[ -x "$BIN" ] || { echo "could not locate the built binary" >&2; exit 1; }

echo "==> built: $BIN"
echo -n "==> highest GLIBC version required: "
objdump -T "$BIN" 2>/dev/null | sed -n 's/.*GLIBC_\([0-9.]*\).*/\1/p' | sort -uV | tail -1
if ldd "$BIN" 2>&1 | grep -q 'not found'; then
  echo "!! unresolved libraries on this host:" >&2
  ldd "$BIN" 2>&1 | grep 'not found' >&2
  exit 1
fi
echo "==> all shared libraries resolve on this host"

[ "$DO_INSTALL" = 1 ] || exit 0

echo "==> installing into $PREFIX"
install -Dm755 "$BIN" "$PREFIX/bin/glyph"
ICON_SRC="$REPO/src-tauri/icons/128x128@2x.png"
[ -f "$ICON_SRC" ] || ICON_SRC="$REPO/src-tauri/icons/icon.png"
[ -f "$ICON_SRC" ] || ICON_SRC="$REPO/app-icon.png"
install -Dm644 "$ICON_SRC" "$PREFIX/share/icons/hicolor/256x256/apps/glyph.png"

install -Dm644 /dev/stdin "$PREFIX/share/applications/glyph.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Glyph
GenericName=Terminal
Comment=A Nothing-inspired Linux terminal emulator
Exec=$PREFIX/bin/glyph
Icon=glyph
Terminal=false
Categories=System;TerminalEmulator;Development;
DESKTOP

command -v update-desktop-database >/dev/null && update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true

echo "==> installed: $PREFIX/bin/glyph"
case ":$PATH:" in
  *":$PREFIX/bin:"*) echo "==> run it with: glyph" ;;
  *) echo "==> $PREFIX/bin is not on your PATH; run it with: $PREFIX/bin/glyph" ;;
esac
