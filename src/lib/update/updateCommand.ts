import type { UpdateInfo } from "./types";

/**
 * The shell command placed into the terminal when the update badge is
 * clicked. It's pinned to the release's own tag (not `main`) so the script
 * that runs is the one audited and shipped alongside that exact release —
 * a later, possibly compromised push to `main` can't retroactively change
 * what already-released versions execute.
 */
export function buildUpdateCommand(update: UpdateInfo): string {
  const scriptUrl = `https://raw.githubusercontent.com/SARATHKUMAR-T/glyph/${update.tag}/scripts/self-update.sh`;
  return `curl -fsSL ${scriptUrl} | bash -s -- ${update.tag}`;
}
