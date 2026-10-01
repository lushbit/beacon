import { useId, useMemo, useState } from "react";
import GridLayout, { type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { CanvasBlock, CanvasBlockType } from "@beacon/shared";
import { CANVAS_BLOCK_INFO, CANVAS_COLUMNS, CANVAS_GAP, CANVAS_ROW_HEIGHT } from "@beacon/shared";
import { cn } from "@/lib/utils";
import { BlockView } from "../BlockView";
import { bottomOf, fitAt } from "../layout";
import { useBoxSize } from "../useBoxSize";
import { BLOCK_ICONS } from "./BlockLibrary";

const DROPPING_ID = "__dropping__";
/**
 * Empty rows kept under the lowest block. The grid otherwise fills the screen,
 * so it only grows, and the page only scrolls, once a block comes near the
 * bottom.
 */
const SPARE_ROWS = 4;
/** The size the + on an empty spot shows wherever it fits. The block picked keeps its own size. */
const GHOST = { w: 6, h: 4 };

interface EditorGridProps {
  blocks: CanvasBlock[];
  selectedId: string | null;
  dragType: CanvasBlockType | null;
  onSelect: (id: string | null) => void;
  /** Positions after a drag or resize, and the block that was dragged or resized. */
  onLayout: (positions: Map<string, { x: number; y: number; w: number; h: number }>, movedId: string) => void;
  onDrop: (type: CanvasBlockType, at: { x: number; y: number; w: number; h: number }, positions: Map<string, { x: number; y: number; w: number; h: number }>) => void;
  /** The + on an empty spot was pressed, at the cell under the pointer. */
  onAddAt: (cell: { col: number; row: number }) => void;
  /** Somewhere on the page that is not a block was clicked. */
  onBackground: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** How much the page is shrunk to fit between the sidebars. 1 is full size. */
  scale: number;
  /** The visible height, in unscaled pixels, the grid should at least fill. */
  fillHeight: number;
}

function positionsOf(layout: Layout[]): Map<string, { x: number; y: number; w: number; h: number }> {
  return new Map(layout.filter((item) => item.i !== DROPPING_ID).map((item) => [item.i, { x: item.x, y: item.y, w: item.w, h: item.h }]));
}

/**
 * The page being built, on the same grid visitors see. Blocks are dragged by
 * any part of them and resized from their edges, and can go anywhere, with
 * empty space around them if wanted. While a block is dragged it may pass over
 * others without disturbing them. Where it is let go, anything it lands on
 * moves down to make room, so nothing is shoved about on the way there.
 */
export function EditorGrid({
  blocks,
  selectedId,
  dragType,
  onSelect,
  onLayout,
  onDrop,
  onAddAt,
  onBackground,
  onDuplicate,
  onDelete,
  scale,
  fillHeight,
}: EditorGridProps) {
  const [ref, size] = useBoxSize<HTMLDivElement>();
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; h: number; col: number; row: number } | null>(null);
  const [interacting, setInteracting] = useState(false);
  const patternId = `canvas-grid-${useId().replace(/:/g, "")}`;

  const width = size.width;
  const colWidth = width > 0 ? (width - CANVAS_GAP * (CANVAS_COLUMNS - 1)) / CANVAS_COLUMNS : 0;
  // Down to the bottom of the screen, wherever the grid starts on the page.
  const top = ref.current?.offsetTop ?? 0;
  const screenRows = Math.floor((fillHeight - top + CANVAS_GAP) / (CANVAS_ROW_HEIGHT + CANVAS_GAP));
  const rows = Math.max(bottomOf(blocks) + SPARE_ROWS, screenRows, 1);
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
   * The + for the free cell under the pointer. It always covers that cell and
   * sits centred on it where there is room, at the same size everywhere except
   * in gaps too small for it.
   */
  const spotAt = (clientX: number, clientY: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    // The pointer is in screen pixels, the grid in page pixels. A cell and the
    // gap after it count as one step, so the gap belongs to the cell before it.
    const x = (clientX - rect.left) / scale / (colWidth + CANVAS_GAP);
    const y = (clientY - rect.top) / scale / (CANVAS_ROW_HEIGHT + CANVAS_GAP);
    const col = Math.floor(x);
    const row = Math.floor(y);
    if (col < 0 || col >= CANVAS_COLUMNS || row < 0 || row >= rows) return null;
    // Kept inside the grid as it is, so hovering never makes the page longer.
    const spot = fitAt(blocks, { col, row }, GHOST, { w: 1, h: 1 }, undefined, { point: { x, y }, maxRow: rows });
    return spot ? { ...spot, col, row } : null;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (interacting || dragType) return;
    const target = event.target as HTMLElement;
    if (!target.classList.contains("canvas-grid-surface") && !target.classList.contains("react-grid-layout")) {
      if (ghost) setGhost(null);
      return;
    }
    const spot = spotAt(event.clientX, event.clientY, event.currentTarget);
    setGhost((current) =>
      spot && current && spot.x === current.x && spot.y === current.y && spot.w === current.w && spot.h === current.h ? { ...current, col: spot.col, row: spot.row } : spot
    );
  };

  const tileWidth = colWidth + CANVAS_GAP;
  const tileHeight = CANVAS_ROW_HEIGHT + CANVAS_GAP;

  return (
    <div
      ref={ref}
      className="canvas-editor canvas-grid-surface relative w-full"
      style={{ minHeight: height, cursor: ghost ? "pointer" : undefined }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setGhost(null)}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (!target.classList.contains("canvas-grid-surface") && !target.classList.contains("react-grid-layout")) return;
        onSelect(null);
        // A click on a free spot adds a block there, where the outline shows.
        // Worked out from the click itself, since a tap on a touch screen
        // comes without any hovering first.
        const spot = spotAt(event.clientX, event.clientY, event.currentTarget);
        if (spot) {
          onAddAt({ col: spot.col, row: spot.row });
          setGhost(null);
        } else {
          onBackground();
        }
      }}
    >
      {/*
        Graph paper, in the style of the shadcn grid pattern: one square per
        grid cell, its lines running through the middle of the gaps, so every
        block sits neatly inside the lines it snaps to. The layer starts half a
        gap outside the grid so the outer edges get their lines too.
      */}
      {colWidth > 0 ? (
        <svg
          aria-hidden
          className="pointer-events-none absolute"
          style={{ left: -CANVAS_GAP / 2, top: -CANVAS_GAP / 2 }}
          width={width + CANVAS_GAP}
          height={height + CANVAS_GAP}
        >
          <defs>
            <pattern id={patternId} width={tileWidth} height={tileHeight} patternUnits="userSpaceOnUse">
              <path d={`M.5 ${tileHeight}V.5H${tileWidth}`} fill="none" stroke="hsl(0 0% 100% / 0.07)" strokeWidth={1} />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${patternId})`} />
          {/* The closing lines on the right and at the bottom. */}
          <path
            d={`M${width + CANVAS_GAP - 0.5} 0V${height + CANVAS_GAP - 0.5}H0`}
            fill="none"
            stroke="hsl(0 0% 100% / 0.07)"
            strokeWidth={1}
          />
          {ghost ? (
            // The cells the new block would cover, filled in like the
            // highlighted squares of the pattern.
            <rect
              x={ghost.x * tileWidth + 1}
              y={ghost.y * tileHeight + 1}
              width={ghost.w * tileWidth - 1}
              height={ghost.h * tileHeight - 1}
              fill="hsl(0 0% 100% / 0.035)"
            />
          ) : null}
        </svg>
      ) : null}
      {ghost && colWidth > 0 ? (
        // Only drawn. The pointer goes straight through to the grid below, so the
        // outline can follow it every step instead of hiding the next move.
        <div
          aria-hidden
          className="pointer-events-none absolute z-[3] flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-foreground/45 bg-foreground/[0.04] text-xs font-medium text-foreground/80"
          style={{
            left: ghost.x * (colWidth + CANVAS_GAP),
            top: ghost.y * (CANVAS_ROW_HEIGHT + CANVAS_GAP),
            width: ghost.w * colWidth + (ghost.w - 1) * CANVAS_GAP,
            height: ghost.h * CANVAS_ROW_HEIGHT + (ghost.h - 1) * CANVAS_GAP,
          }}
        >
          <Plus className="h-4 w-4 shrink-0" />
          {ghost.w >= 3 ? "Add block" : null}
        </div>
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
          compactType={null}
          allowOverlap
          isBounded
          useCSSTransforms
          transformScale={scale}
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
          onDragStop={(next, _old, item) => {
            setInteracting(false);
            onLayout(positionsOf(next), item.i);
          }}
          onResizeStart={(_layout, item) => {
            setInteracting(true);
            onSelect(item.i);
          }}
          onResizeStop={(next, _old, item) => {
            setInteracting(false);
            onLayout(positionsOf(next), item.i);
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
                  <div
                    className="canvas-no-drag absolute -top-4 right-2 z-10 flex items-center gap-0.5 rounded-md border border-border bg-popover px-1 py-0.5 shadow-lg shadow-black/40"
                    // Undoes the page's shrink, so the buttons stay a comfortable size.
                    style={{ transform: scale < 1 ? `scale(${1 / scale})` : undefined, transformOrigin: "bottom right" }}
                  >
                    <span className="flex items-center gap-1 px-1.5 text-xs text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                      {block.w}×{block.h}
                    </span>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-surface-3 hover:text-foreground"
                      title="Duplicate"
                      aria-label="Duplicate block"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDuplicate(block.id);
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-danger/15 hover:text-danger"
                      title="Delete"
                      aria-label="Delete block"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDelete(block.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
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
