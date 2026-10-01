import { useMemo, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { CanvasBlock, CanvasBlockType } from "@beacon/shared";
import { CANVAS_BLOCK_INFO, CANVAS_COLUMNS, CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@beacon/shared";
import { cn } from "@/lib/utils";
import { BlockView } from "../BlockView";
import { bottomOf, landingSpot, overlaps } from "../layout";
import { useBoxSize } from "../useBoxSize";
import { BLOCK_ICONS } from "./BlockLibrary";

const DROPPING_ID = "__dropping__";
/** Empty rows kept under the last block, so there is always room to add more. */
const SPARE_ROWS = 8;
/** The size the + on an empty spot always shows. The block picked keeps its own size. */
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
        return { i: block.id, x: block.x, y: block.y, w: block.w, h: block.h, minW: info.minW, minH: info.minH, maxW: info.maxW, maxH: info.maxH };
      }),
    [blocks]
  );

  /**
   * The + for the free cell under the pointer. It is always the same size and
   * sits where a new block would really end up, since the page packs upwards.
   */
  const spotAt = (clientX: number, clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const col = Math.floor((clientX - rect.left) / (colWidth + CANVAS_GAP));
    const row = Math.floor((clientY - rect.top) / (CANVAS_ROW_HEIGHT + CANVAS_GAP));
    if (col < 0 || col >= CANVAS_COLUMNS || row < 0) return null;
    if (blocks.some((block) => overlaps({ x: col, y: row, w: 1, h: 1 }, block))) return null;
    // Slides left until it fits beside whatever is to its right.
    for (let x = Math.min(col, CANVAS_COLUMNS - GHOST.w); x >= Math.max(0, col - GHOST.w + 1); x -= 1) {
      const spot = landingSpot(blocks, { x, y: row, w: GHOST.w, h: GHOST.h });
      if (!blocks.some((block) => overlaps(spot, block))) return spot;
    }
    return null;
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

  // A dot where each row and column meet, so the grid is there without
  // competing with the blocks on it.
  const dots =
    colWidth > 0
      ? {
          backgroundImage: "radial-gradient(circle, hsl(0 0% 100% / 0.16) 1.2px, transparent 1.6px)",
          backgroundSize: `${colWidth + CANVAS_GAP}px ${CANVAS_ROW_HEIGHT + CANVAS_GAP}px`,
          backgroundPosition: `${-CANVAS_GAP / 2 - (colWidth + CANVAS_GAP) / 2}px ${-CANVAS_GAP / 2 - (CANVAS_ROW_HEIGHT + CANVAS_GAP) / 2}px`,
        }
      : {};

  return (
    <div
      ref={ref}
      className="canvas-editor canvas-grid-surface relative w-full"
      style={{ minHeight: height, ...dots }}
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
          Add block
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
