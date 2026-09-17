import { useNow } from "@/lib/clock";
import { formatDuration, formatRelative } from "@/lib/format";

/** A relative time such as "2m ago" that keeps itself current every second. */
export function RelativeTime({ value }: { value: number | null | undefined }) {
  const now = useNow();
  return <>{formatRelative(value, now)}</>;
}

/**
 * How long something has lasted, counting up on its own while it is still
 * going. `to` ends it: an alert that has been resolved shows how long it ran
 * for and then stops, where one still firing keeps climbing from 1m to 2m
 * without the page being reloaded.
 */
export function Duration({ from, to }: { from: number; to?: number | null }) {
  const now = useNow();
  const end = to ?? now;
  return <>{formatDuration(Math.max(0, end - from) / 1000)}</>;
}
