import { LayoutDashboard } from "lucide-react";
import type { CanvasBlock } from "@beacon/shared";
import { CANVAS_COLUMNS, CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@beacon/shared";
import { EmptyState } from "@/components/ui/misc";
import { BlockView } from "./BlockView";
import { useBoxSize } from "./useBoxSize";

/** Below this width the grid gives way to two columns, so nothing is squeezed past reading. */
export const CANVAS_NARROW_WIDTH = 720;

/** Reading order: top to bottom, then left to right. */
export function readingOrder(blocks: CanvasBlock[]): CanvasBlock[] {
  return blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A page as visitors see it. On a wide screen the blocks sit exactly where the
 * editor put them, on the same 24 column grid. On a narrow one they flow into
 * two columns in reading order, small blocks side by side and wide ones across.
 * Either way the page fits the width of the window and only ever grows down.
 */
export function CanvasView({ blocks }: { blocks: CanvasBlock[] }) {
  const [ref, size] = useBoxSize<HTMLDivElement>();
  const narrow = size.width > 0 && size.width < CANVAS_NARROW_WIDTH;

  if (blocks.length === 0) {
    return <EmptyState icon={LayoutDashboard} title="Nothing on this page yet." />;
  }

  return (
    <div ref={ref} className="w-full min-w-0">
      {size.width === 0 ? null : narrow ? (
        <div
          className="grid w-full"
          style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gridAutoRows: CANVAS_ROW_HEIGHT, gap: CANVAS_GAP }}
        >
          {readingOrder(blocks).map((block) => (
            <div
              key={block.id}
              className="min-h-0 min-w-0"
              style={{
                gridColumn: block.w > 8 ? "span 2" : "span 1",
                gridRow: `span ${block.h}`,
              }}
            >
              <BlockView block={block} />
            </div>
          ))}
        </div>
      ) : (
        <div
          className="grid w-full"
          style={{
            gridTemplateColumns: `repeat(${CANVAS_COLUMNS}, minmax(0, 1fr))`,
            gridAutoRows: CANVAS_ROW_HEIGHT,
            gap: CANVAS_GAP,
          }}
        >
          {blocks.map((block) => (
            <div
              key={block.id}
              className="min-h-0 min-w-0"
              style={{ gridColumn: `${block.x + 1} / span ${block.w}`, gridRow: `${block.y + 1} / span ${block.h}` }}
            >
              <BlockView block={block} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
