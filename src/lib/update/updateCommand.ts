import type { UpdateInfo } from "./types";

/**
 * The shell command placed into the terminal when the update badge is
 * clicked. It's pinned to the release's own tag (not `main`) so the script
 * that runs is the one audited and shipped alongside that exact release —
 * a later, possibly compromised push to `main` can't retroactively change
 * what already-released versions execute.
 *
 * `sudo -v` runs first so the password prompt appears up front, at a normal
 * shell prompt, instead of partway through the `curl | bash` pipe. The
 * script's own `sudo dpkg -i` (the .deb path) then reuses the cached
 * credentials. Only the credentials are cached: the script itself still
 * runs unprivileged, so the AppImage path keeps `$APPIMAGE`, and
 * `sudo curl`/`| sudo bash` are avoided on purpose (the first would give
 * root only to the download, the second would run the whole script as root).
 *
 * The script fetch itself prints nothing, so right after the password
 * prompt a slow, filtered, or blocked route to raw.githubusercontent.com
 * used to look like the update had silently frozen. The `echo` says what's
 * happening, and the timeouts turn a stalled fetch into curl's own visible
 * error instead of an indefinite hang. No `--retry`: a retry after a
 * partial transfer would pipe a duplicated script body into bash.
 */
export function buildUpdateCommand(update: UpdateInfo): string {
  const scriptUrl = `https://raw.githubusercontent.com/SARATHKUMAR-T/glyph/${update.tag}/scripts/self-update.sh`;
  return (
    `sudo -v && echo "[glyph-update] Fetching the ${update.tag} installer..." && ` +
    `curl -fsSL --connect-timeout 20 --max-time 120 ${scriptUrl} | bash -s -- ${update.tag}`
  );
}
