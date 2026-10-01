import { useMemo, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { CanvasBlock, CanvasBlockType } from "@beacon/shared";
import { CANVAS_BLOCK_INFO, CANVAS_COLUMNS, CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@beacon/shared";
import { cn } from "@/lib/utils";
import { BlockView } from "../BlockView";
import { bottomOf, overlaps } from "../layout";
import { useBoxSize } from "../useBoxSize";
import { BLOCK_ICONS } from "./BlockLibrary";

const DROPPING_ID = "__dropping__";
/** Empty rows kept under the last block, so there is always room to add more. */
const SPARE_ROWS = 8;
/** The size the + on an empty spot offers, before it is cut to the space free there. */
const GHOST = { w: 6, h: 4 };

interface EditorGridProps {
  blocks: CanvasBlock[];
  selectedId: string | null;
  dragType: CanvasBlockType | null;
  onSelect: (id: string | null) => void;
  /** Positions after a drag or resize, for every block that moved. */
  onLayout: (positions: Map<string, { x: number; y: number; w: number; h: number }>) => void;
  onDrop: (type: CanvasBlockType, at: { x: number; y: number; w: number; h: number }, positions: Map<string, { x: number; y: number; w: number; h: number }>) => void;
  /** The + on an empty spot was pressed. */
  onAddAt: (at: { x: number; y: number; w: number; h: number }) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

function positionsOf(layout: Layout[]): Map<string, { x: number; y: number; w: number; h: number }> {
  return new Map(layout.filter((item) => item.i !== DROPPING_ID).map((item) => [item.i, { x: item.x, y: item.y, w: item.w, h: item.h }]));
}

/**
 * The page being built, on the same grid visitors see. Blocks are dragged by
 * any part of them and resized from their edges. Blocks always pack upwards,
 * as on a Grafana dashboard: dragging over a block moves it out of the way
 * and back again, and no hole is ever left behind. A Spacer block holds room
 * open where a gap is wanted.
 */
export function EditorGrid({ blocks, selectedId, dragType, onSelect, onLayout, onDrop, onAddAt, onDuplicate, onDelete }: EditorGridProps) {
  const [ref, size] = useBoxSize<HTMLDivElement>();
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [interacting, setInteracting] = useState(false);

  const width = size.width;
  const colWidth = width > 0 ? (width - CANVAS_GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS : 0;
  const rows = bottomOf(blocks) + SPARE_ROWS;
  const height = rows * CANVAS_ROW_HEIGHT + (rows - 1) * CANVAS_GAP;

  const layout = useMemo<Layout[]>(
    () =>
      blocks.map((block) => {
        const info = CANVAS_BLOCK_INFO[block.type];
        return { i: block.id, x: block.x, y: block.y, w: block.w, h: block.h, minW: info.minW, minH: info.minH };
      }),
    [blocks]
  );

  /** The free spot under the pointer, as big as fits up to the default size. */
  const spotAt = (clientX: number, clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left) / (colWidth + CANVAS_GAP));
    const row = Math.floor((clientY - rect.top) / (CANVAS_ROW_HEIGHT + CANVAS_GAP));
    if (col < 0 || col >= CANVAS_COLUMNS || row < 0) return null;
    const free = (x: number, y: number, w: number, h: number) => !blocks.some((block) => overlaps({ x, y, w, h }, block));
    if (!free(col, row, 1, 1)) return null;
    let w = 1;
    while (w < GHOST.w && col + w < CANVAS_COLUMNS && free(col, row, w + 1, 1)) w += 1;
    let h = 1;
    while (h < GHOST.h && free(col, row, w, h + 1)) h += 1;
    return { x: col, y: row, w, h };
  };

  const onBackground = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interacting || dragType) return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains("canvas-grid-surface") && !target.classList.contains("react-grid-layout")) {
      if (ghost) setGhost(null);
      return;
    }
    const spot = spotAt(event.clientX, event.clientY, event.currentTarget);
    setGhost((current) =>
      spot && current && spot.x === current.x && spot.y === current.y && spot.w === current.w && spot.h === current.h ? current : spot
    );
  };

  const columnStripes =
    colWidth > 0
      ? `repeating-linear-gradient(to right, hsl(0 0% 100% / 0.022) 0 ${colWidth}px, transparent ${colWidth}px ${colWidth + CANVAS_GAP}px)`
      : undefined;

  return (
    <div
      ref={ref}
      className="canvas-editor canvas-grid-surface relative w-full"
      style={{ minHeight: height, backgroundImage: columnStripes }}
      onPointerMove={onBackground}
      onPointerLeave={() => setGhost(null)}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains("canvas-grid-surface") || target.classList.contains("react-grid-layout")) onSelect(null);
      }}
    >
      {ghost && colWidth > 0 ? (
        <button
          type="button"
          className="absolute z-[3] flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/30 bg-foreground/[0.03] text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/60 hover:text-foreground"
          style={{
            left: ghost.x * (colWidth + CANVAS_GAP),
            top: ghost.y * (CANVAS_ROW_HEIGHT + CANVAS_GAP),
            width: ghost.w * colWidth + (ghost.w - 1) * CANVAS_GAP,
            height: ghost.h * CANVAS_ROW_HEIGHT + (ghost.h - 1) * CANVAS_GAP,
          }}
          onClick={(event) => {
            event.stopPropagation();
            onAddAt(ghost);
            setGhost(null);
          }}
          onPointerMove={(event) => event.stopPropagation()}
        >
          <Plus className="h-4 w-4" />
          {ghost.w >= 3 ? "Add block" : null}
        </button>
      ) : null}

      {width > 0 ? (
        <GridLayout
          className="relative z-[2]"
          style={{ minHeight: height }}
          layout={layout}
          cols={CANVAS_COLUMNS}
          rowHeight={CANVAS_ROW_HEIGHT}
          width={width}
          margin={[CANVAS_GAP, CANVAS_GAP]}
          containerPadding={[0, 0]}
          compactType="vertical"
          preventCollision={false}
          allowOverlap={false}
          isBounded
          useCSSTransforms
          resizeHandles={["s", "e", "se", "sw", "w"]}
          draggableCancel=".canvas-no-drag"
          isDroppable
          droppingItem={{ i: DROPPING_ID, w: dragType ? CANVAS_BLOCK_INFO[dragType].w : GHOST.w, h: dragType ? CANVAS_BLOCK_INFO[dragType].h : GHOST.h }}
          onDropDragOver={() => (dragType ? { w: CANVAS_BLOCK_INFO[dragType].w, h: CANVAS_BLOCK_INFO[dragType].h } : false)}
          onDrop={(next, item) => {
            if (!dragType || !item) return;
            onDrop(dragType, { x: item.x, y: item.y, w: item.w, h: item.h }, positionsOf(next));
          }}
          onDragStart={(_layout, item) => {
            setInteracting(true);
            setGhost(null);
            onSelect(item.i);
          }}
          onDragStop={(next) => {
            setInteracting(false);
            onLayout(positionsOf(next));
          }}
          onResizeStart={(_layout, item) => {
            setInteracting(true);
            onSelect(item.i);
          }}
          onResizeStop={(next) => {
            setInteracting(false);
            onLayout(positionsOf(next));
          }}
        >
          {blocks.map((block) => {
            const selected = block.id === selectedId;
            const Icon = BLOCK_ICONS[block.type];
            return (
              <div
                key={block.id}
                className={cn(
                  "group/block rounded-lg outline-offset-2 transition-[outline-color]",
                  selected ? "outline outline-2 outline-foreground/80" : "outline outline-1 outline-transparent hover:outline-foreground/25",
                  (block.type === "spacer" || !block.frame) && "border border-dashed border-border bg-foreground/[0.015]"
                )}
                onPointerDown={() => onSelect(block.id)}
              >
                {/* The content does not take the pointer, so a block can be
                    dragged by any part of it, charts included. */}
                <div className="pointer-events-none h-full w-full select-none">
                  {block.type === "spacer" ? (
                    <div className="flex h-full items-center justify-center text-2xs text-muted-foreground/70">Spacer</div>
                  ) : (
                    <BlockView block={block} />
                  )}
                </div>
                {selected ? (
                  <div className="canvas-no-drag absolute -top-3 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-0.5 shadow-lg shadow-black/40">
                    <span className="flex items-center gap-1 px-1 text-2xs text-muted-foreground">
                      <Icon className="h-3 w-3" />
                      {block.w}×{block.h}
                    </span>
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                      title="Duplicate"
                      aria-label="Duplicate block"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDuplicate(block.id);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-danger/15 hover:text-danger"
                      title="Delete"
                      aria-label="Delete block"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(block.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </GridLayout>
      ) : null}
    </div>
  );
}
