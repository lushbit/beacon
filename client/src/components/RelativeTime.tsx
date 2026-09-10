import { useNow } from "@/lib/clock";
import { formatRelative } from "@/lib/format";

/** A relative time such as "2m ago" that keeps itself current every second. */
export function RelativeTime({ value }: { value: number | null | undefined }) {
  const now = useNow();
  return <>{formatRelative(value, now)}</>;
}
