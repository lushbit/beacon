import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { CanvasBlock } from "@beacon/shared";
import { cn } from "@/lib/utils";

interface BlockFrameProps {
  block: CanvasBlock;
  children: ReactNode;
  /** Sits at the right of the title row, such as a chart's current value. */
  aside?: ReactNode;
  /** The block draws its own label, so the title row is left out. */
  hideTitle?: boolean;
  bodyClassName?: string;
}

/**
 * The card a block sits in, or nothing at all when the block is set to draw
 * straight onto the page. Every block fills the grid cell it was given and
 * never grows past it, so a page keeps the shape it was built with.
 */
export function BlockFrame({ block, children, aside, hideTitle, bodyClassName }: BlockFrameProps) {
  const showHeader = !hideTitle && (block.title !== "" || aside !== undefined);
  return (
    <section
      className={cn(
        "flex h-full w-full min-w-0 flex-col overflow-hidden",
        block.frame && "rounded-lg border border-border/70 bg-card"
      )}
    >
      {showHeader ? (
        <header
          className={cn("flex min-h-[1.25rem] shrink-0 items-start justify-between gap-3", block.frame ? "px-4 pt-3" : "pb-1.5")}
        >
          <h3 className="min-w-0 truncate text-sm font-medium text-foreground">{block.title}</h3>
          {aside ? <div className="flex min-w-0 shrink items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div
        className={cn(
          "relative min-h-0 flex-1",
          block.frame && (showHeader ? "px-4 pb-3 pt-2" : "p-4"),
          bodyClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** What a block shows instead of its content, such as before a device is picked. */
export function BlockNote({ icon: Icon, text }: { icon?: LucideIcon; text: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 px-3 text-center">
      {Icon ? <Icon className="h-4 w-4 text-muted-foreground" /> : null}
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
  );
}
