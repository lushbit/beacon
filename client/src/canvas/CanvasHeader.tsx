import type { CanvasContent } from "@beacon/shared";
import { canvasRangeLabel } from "@beacon/shared";
import { RelativeTime } from "@/components/RelativeTime";
import { cn } from "@/lib/utils";

/** The ranges a page offers, default first among them, in order. */
export function pageRanges(content: CanvasContent): number[] {
  return Array.from(new Set([content.options.defaultRange, ...content.options.visitorRanges])).sort((a, b) => a - b);
}

/**
 * The title bar over a page: name, description, the live mark and the range
 * buttons. The editor draws the same one, so a page is laid out against the
 * same space it will have once published.
 */
export function CanvasHeader({
  content,
  range,
  onRange,
  updatedAt,
}: {
  content: CanvasContent;
  range: number;
  onRange: (seconds: number) => void;
  updatedAt: number | null;
}) {
  const ranges = pageRanges(content);
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 sm:mb-7">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{content.title}</h1>
        {content.description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{content.description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {content.options.showUpdated ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-success/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            Updated <RelativeTime value={updatedAt} />
          </span>
        ) : null}
        {ranges.length > 1 ? (
          <div className="flex rounded-md border border-border bg-surface p-0.5" role="group" aria-label="Time range">
            {ranges.map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => onRange(seconds)}
                aria-pressed={seconds === range}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  seconds === range ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {canvasRangeLabel(seconds)}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/** The column a page sits in. Shared by the public page and the editor so both are equally wide. */
export const PAGE_COLUMN = "mx-auto w-full px-3 sm:px-5";

export function pageColumnStyle(maxWidth: number): React.CSSProperties | undefined {
  return maxWidth ? { maxWidth: maxWidth + 40 } : undefined;
}
