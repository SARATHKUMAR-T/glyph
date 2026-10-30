# Building Glyph on Ubuntu 20.04 (focal)

## The problem

Glyph's published binaries are produced on Ubuntu 24.04, so they reference
symbols up to `GLIBC_2.39`. Ubuntu 20.04 ships GLIBC 2.31 and the loader refuses
them:

```
/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found
```

GLIBC cannot be upgraded independently of the distribution, so the only fix is to
build Glyph against focal's own libraries.

## What stands in the way

Focal's libraries are new enough to *run* Glyph, but the Rust crates in the Tauri
stack refuse to build against them:

| Requirement | Focal has | Resolution |
| --- | --- | --- |
| `webkit2gtk-4.1`, `javascriptcoregtk-4.1` | only the `-4.0` modules | pkg-config shims + linker symlinks |
| `libsoup-3.0 >= 3.0` | libsoup 2.72 | pkg-config shim |
| `glib/gobject/gio >= 2.70` | 2.64.6 | pkg-config shims |
| WebKitGTK `>= 2.40` | **2.38.6** | crate patches |
| Node 20+ (vite 8 / React 19) | Node 10 | Node 22 in the builder image |

The `-4.0` and `-4.1` WebKitGTK flavours are the *same engine* — focal's is
2.38.6 — differing only in whether they link libsoup2 or libsoup3. That is what
makes the shims safe.

## The approach

`scripts/build-local.sh` builds Glyph inside an **Ubuntu 20.04 container**:

- Same GLIBC (2.31) and same WebKitGTK (2.38.6) as the host, so the binary runs
  natively on the host — it is *not* run in the container.
- Node and Rust live in the image, so **nothing is installed on the host** and no
  `sudo` is required.
- The build happens out of tree, so the repository's `Cargo.lock` is never
  rewritten by the `[patch.crates-io]` entries.

The result requires at most `GLIBC_2.30` and links against
`libwebkit2gtk-4.0.so.37`, `libjavascriptcoregtk-4.0.so.18` and
`libsoup-2.4.so.1` — the libraries a focal desktop already has.

### pkg-config shims (`docker/Dockerfile.focal-builder`)

Copies of focal's own `.pc` files under the module names/versions the crates
demand. Every original `-l`/`-I` flag is preserved, so the build links focal's
real libraries. Three `-sys` crates also hardcode library names via
`#[link(name = "webkit2gtk-4.1")]` and friends, bypassing pkg-config, so the
image adds link-time-only symlinks for those names. The `DT_NEEDED` entries in
the binary come from each target's SONAME, so the `-4.1` names never reach the
output.

### Crate patches (`docker/patches/`)

Four crates request `webkit2gtk/v2_40`, which makes `webkit2gtk-sys` demand
WebKitGTK 2.40. Three of them (`tauri`, `tauri-runtime`, `tauri-runtime-wry`)
only name `webkit2gtk::WebView` as a type and call no 2.40 API, so the feature
request is simply dropped.

`wry` genuinely uses one 2.40 function, `webkit_uri_scheme_request_get_http_body`,
under its `linux-body` feature — which `tauri-runtime-wry` enables
unconditionally, so it cannot just be switched off. The patch moves that read
behind a new opt-in feature and fails any custom-protocol request that carries a
body rather than delivering a silently empty one.

Tauri's IPC would otherwise rely on exactly that body, so the `tauri` patch also
excludes Linux from the custom-protocol IPC path (as Android already is),
leaving `invoke()` on the `postMessage` interface. Both are first-class Tauri
transports.

Each patch is pinned to an exact crate version and `scripts/build-local.sh`
refuses to run if `Cargo.lock` moves off it.

### Compatibility shims (`docker/focal-compat.c`)

Five symbols referenced by the generated bindings do not exist in focal's
libraries: `g_uri_error_quark` (GLib 2.66), `soup_message_headers_ref`/`_unref`
(libsoup 3) and `webkit_cookie_manager_get_all_cookies`/`_finish` (WebKitGTK
2.40). All sit on paths Glyph never takes. They are compiled into a static
archive appended to the link line, so only the genuinely missing symbols are
pulled in. See the file for the per-symbol reasoning and limits.

### `tauri/custom-protocol`

Tauri's build script sets `dev = !custom-protocol`, and in dev mode the webview
loads `build.devUrl` instead of the bundled frontend. The Tauri CLI enables that
feature for a release build; a plain `cargo build` has to be told, so the script
passes `--features tauri/custom-protocol`.

## Usage

```bash
scripts/build-local.sh                 # build + install into ~/.local
scripts/build-local.sh --no-install    # build only
scripts/build-local.sh --rebuild-image # refresh the builder image
PREFIX=/opt/glyph scripts/build-local.sh
```

Installs `~/.local/bin/glyph`, a `glyph.desktop` launcher and the icon. No
`sudo`. Caches live in `~/.cache/glyph-build` and `node_modules/`, so repeat
builds take well under a minute.

Supabase backs only the optional `quote` builtin. Copy `.env.example` to `.env`
and fill it in if you want that command to work.

## Verifying

```bash
objdump -T ~/.local/bin/glyph | sed -n 's/.*GLIBC_\([0-9.]*\).*/\1/p' | sort -uV | tail -1   # <= 2.31
ldd ~/.local/bin/glyph | grep -c 'not found'                                                 # 0
```

## Limits of this build

- Custom-protocol request bodies are unavailable. Tauri does not need them here,
  but a plugin that POSTs to a custom protocol would get an error.
- `WebView::cookies()` cannot work on WebKitGTK 2.38 and reports
  `G_IO_ERROR_NOT_SUPPORTED`. Glyph does not use it.
- `SoupMessageHeaders` is single-owner rather than reference counted, which is
  correct for wry's usage but would not survive a caller that cloned them.
