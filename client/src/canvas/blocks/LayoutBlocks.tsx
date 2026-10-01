import { useEffect, useState, type ReactNode } from "react";
import type { CanvasBlockOf } from "@beacon/shared";
import { cn } from "@/lib/utils";
import { BlockFrame } from "./BlockFrame";

const ALIGN = { left: "text-left items-start", center: "text-center items-center", right: "text-right items-end" } as const;

export function HeadingBlock({ block }: { block: CanvasBlockOf<"heading"> }) {
  const { text, subtitle, size, align } = block.config;
  return (
    <BlockFrame block={block} hideTitle bodyClassName={cn("flex flex-col justify-end", ALIGN[align])}>
      <h2
        className={cn(
          "w-full truncate font-semibold tracking-tight text-foreground",
          size === "sm" && "text-base",
          size === "md" && "text-xl",
          size === "lg" && "text-2xl",
          size === "xl" && "text-4xl"
        )}
      >
        {text}
      </h2>
      {subtitle ? <p className="mt-1 w-full truncate text-sm text-muted-foreground">{subtitle}</p> : null}
    </BlockFrame>
  );
}

/**
 * A few marks people already type in chat: **bold**, *italics*, `code` and
 * [links](https://example.com). Everything is built as elements, never as
 * HTML, so a page cannot carry markup or scripts. Links only go to web
 * addresses and open in a new tab.
 */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = `${index++}`;
    if (match[2] !== undefined) parts.push(<strong key={key} className="font-semibold text-foreground">{match[2]}</strong>);
    else if (match[3] !== undefined) parts.push(<em key={key}>{match[3]}</em>);
    else if (match[4] !== undefined)
      parts.push(
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.9em]">
          {match[4]}
        </code>
      );
    else if (match[5] !== undefined)
      parts.push(
        <a key={key} href={match[6]} target="_blank" rel="noopener noreferrer nofollow" className="text-foreground underline underline-offset-2 hover:opacity-80">
          {match[5]}
        </a>
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <>
      {blocks.map((chunk, index) => {
        const lines = chunk.split("\n");
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={index} className="list-disc space-y-0.5 pl-5">
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.replace(/^\s*[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line)}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

export function TextBlock({ block }: { block: CanvasBlockOf<"text"> }) {
  const { text, size, align } = block.config;
  return (
    <BlockFrame block={block} bodyClassName="overflow-y-auto scroll-slim">
      <div
        className={cn(
          "space-y-2 text-muted-foreground",
          size === "sm" && "text-xs",
          size === "md" && "text-sm",
          size === "lg" && "text-base",
          align === "center" && "text-center",
          align === "right" && "text-right"
        )}
      >
        <RichText text={text} />
      </div>
    </BlockFrame>
  );
}

export function DividerBlock({ block }: { block: CanvasBlockOf<"divider"> }) {
  return (
    <BlockFrame block={block} hideTitle bodyClassName="flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      {block.config.label ? (
        <>
          <span className="shrink-0 text-2xs font-medium uppercase tracking-wider text-muted-foreground">{block.config.label}</span>
          <span className="h-px flex-1 bg-border" />
        </>
      ) : null}
    </BlockFrame>
  );
}

export function SpacerBlock() {
  return <div className="h-full w-full" />;
}

export function ClockBlock({ block }: { block: CanvasBlockOf<"clock"> }) {
  const { timeZone, hour12, seconds, showDate } = block.config;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const zone = timeZone || undefined;
  let time = "";
  let date = "";
  try {
    time = now.toLocaleTimeString(undefined, { timeZone: zone, hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined, hour12 });
    date = now.toLocaleDateString(undefined, { timeZone: zone, weekday: "long", month: "long", day: "numeric" });
  } catch {
    time = now.toLocaleTimeString();
  }
  return (
    <BlockFrame block={block} hideTitle bodyClassName="flex flex-col justify-center">
      {block.title ? <p className="shrink-0 truncate text-xs text-muted-foreground">{block.title}</p> : null}
      <div className="min-h-0 flex-1" style={{ containerType: "size" }}>
        <p
          className="flex h-full items-center font-semibold leading-none tracking-tight text-foreground tabular"
          style={{ fontSize: `clamp(1rem, min(${showDate ? 55 : 70}cqh, ${seconds ? 15 : 22}cqw), 7rem)` }}
        >
          {time}
        </p>
      </div>
      {showDate ? <p className="shrink-0 truncate text-xs text-muted-foreground">{date}</p> : null}
    </BlockFrame>
  );
}
