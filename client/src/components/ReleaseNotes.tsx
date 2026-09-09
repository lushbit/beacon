import { useMemo, type ReactNode } from "react";

/**
 * Release notes arrive as the markdown written on the GitHub release. They only
 * ever use headings, bullets and short paragraphs, so a handful of rules render
 * them properly and the project stays free of a markdown dependency.
 *
 * Lines are wrapped at about 80 characters in the notes themselves, so a line
 * that continues an entry is joined back onto it rather than shown as its own.
 */
type Block =
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "paragraph"; text: string };

function parseNotes(body: string): Block[] {
  const blocks: Block[] = [];
  let list: string[] | null = null;
  let paragraph: string | null = null;

  const flush = () => {
    if (list) blocks.push({ kind: "list", items: list });
    if (paragraph) blocks.push({ kind: "paragraph", text: paragraph });
    list = null;
    paragraph = null;
  };

  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }

    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", text: heading[1] });
      continue;
    }

    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph) {
        blocks.push({ kind: "paragraph", text: paragraph });
        paragraph = null;
      }
      list = list ?? [];
      list.push(bullet[1]);
      continue;
    }

    if (list) {
      list[list.length - 1] += ` ${line}`;
      continue;
    }
    paragraph = paragraph ? `${paragraph} ${line}` : line;
  }

  flush();
  return blocks;
}

/** Code spans and bold, which is all the notes use inside a line. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={index} className="rounded bg-surface-2 px-1 py-0.5 text-[0.95em] text-foreground">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className="font-medium text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return part;
  });
}

export function ReleaseNotes({ body, className }: { body: string; className?: string }) {
  const blocks = useMemo(() => parseNotes(body), [body]);

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p
              key={index}
              className="mt-4 text-2xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0"
            >
              {block.text}
            </p>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="mt-2 space-y-1.5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex gap-2 text-sm text-muted-foreground">
                  <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span>{inline(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="mt-2 text-sm text-muted-foreground first:mt-0">
            {inline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
