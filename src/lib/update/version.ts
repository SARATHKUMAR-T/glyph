/**
 * Minimal semver comparison — good enough for release tags like "0.3.0" or
 * "0.3.0-beta.1". No dependency is pulled in for this since the app only
 * ever compares its own version against a GitHub release tag, both of
 * which we control the format of.
 *
 * Returns > 0 if `a` is newer than `b`, < 0 if older, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitPrerelease(a);
  const [bCore, bPre] = splitPrerelease(b);

  const aParts = aCore.split(".").map(toNumber);
  const bParts = bCore.split(".").map(toNumber);

  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const diff = (aParts[i] ?? 0) - (bParts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Same core version: a release without a prerelease suffix outranks one
  // with one (1.0.0 > 1.0.0-beta.1); otherwise compare suffixes lexically.
  if (aPre === bPre) return 0;
  if (aPre === "") return 1;
  if (bPre === "") return -1;
  return aPre < bPre ? -1 : 1;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}

function splitPrerelease(version: string): [string, string] {
  const [core, ...rest] = version.split("-");
  return [core, rest.join("-")];
}

function toNumber(part: string): number {
  const n = Number.parseInt(part, 10);
  return Number.isNaN(n) ? 0 : n;
}
