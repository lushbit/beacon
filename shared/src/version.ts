/**
 * Single source of truth for the release version. The hub, the agent and the
 * dashboard all report this, and the update check compares it against the
 * latest published release.
 */
export const BEACON_VERSION = "1.0.0";

/** Semver comparison limited to what releases actually use: MAJOR.MINOR.PATCH with an optional pre-release. */
export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => {
    const cleaned = value.trim().replace(/^v/i, "");
    const [core = "", pre = ""] = cleaned.split("-", 2);
    const parts = core.split(".").map((part) => Number.parseInt(part, 10) || 0);
    return { parts, pre };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // A release without a pre-release tag outranks one with it (1.0.0 > 1.0.0-rc1).
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

export function isNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
