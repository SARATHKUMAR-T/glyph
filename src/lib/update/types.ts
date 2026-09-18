/** A GitHub Release newer than the running build, as surfaced to the UI. */
export type UpdateInfo = {
  /** Release tag with any leading "v" stripped, e.g. "0.3.0". */
  version: string;
  /** Original tag name as published, e.g. "v0.3.0" — the self-update script is pinned to this. */
  tag: string;
  /** Release notes body (Markdown, unrendered) for the badge's tooltip/detail. */
  notes: string;
  /** Public URL of the GitHub release page. */
  htmlUrl: string;
  publishedAt: string;
};
