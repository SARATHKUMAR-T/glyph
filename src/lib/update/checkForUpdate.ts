import type { UpdateInfo } from "./types";
import { isNewerVersion } from "./version";

/**
 * Public, unauthenticated GitHub Releases endpoint — no token, no server of
 * our own. It's CORS-enabled for GETs on public repos, so this can be
 * called straight from the webview. Unauthenticated rate limit is 60
 * requests/hour per IP, which the polling interval in useUpdateChecker
 * stays comfortably under.
 */
const RELEASES_API_URL = "https://api.github.com/repos/SARATHKUMAR-T/glyph/releases/latest";

type GitHubRelease = {
  tag_name: string;
  html_url: string;
  body: string | null;
  published_at: string;
  draft: boolean;
  prerelease: boolean;
};

/**
 * Fetches the latest published GitHub release and returns it as
 * `UpdateInfo` if it's newer than `currentVersion`, or `null` if the app is
 * already current (or the check failed — treated as "nothing to report"
 * rather than surfaced as an error, since a missed check is retried on the
 * next interval anyway).
 */
export async function checkForUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const response = await fetch(RELEASES_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub releases check failed: HTTP ${response.status}`);
  }

  const release: GitHubRelease = await response.json();
  if (release.draft || release.prerelease) return null;

  const version = release.tag_name.replace(/^v/, "");
  if (!isNewerVersion(version, currentVersion)) return null;

  return {
    version,
    tag: release.tag_name,
    notes: release.body ?? "",
    htmlUrl: release.html_url,
    publishedAt: release.published_at,
  };
}
