import type { CanvasBlock, CanvasBlockType, CanvasContent, CanvasDeviceMeta } from "@beacon/shared";
import {
  CANVAS_BLOCK_INFO,
  CANVAS_COLUMNS,
  canvasMetric,
  clampBlock,
  defaultThresholds,
  emptyCanvasContent,
  newCanvasBlock,
  type CanvasSource,
} from "@beacon/shared";

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function bottomOf(blocks: CanvasBlock[]): number {
  return blocks.reduce((bottom, block) => Math.max(bottom, block.y + block.h), 0);
}

/**
 * Makes room for a block that was just placed: anything it lands on moves
 * down below it, and anything that lands on those moves down in turn. Blocks
 * nothing touched stay exactly where they were.
 */
export function makeRoom(blocks: CanvasBlock[], fixedId: string): CanvasBlock[] {
  const fixed = blocks.find((block) => block.id === fixedId);
  if (!fixed) return blocks;
  const settled: CanvasBlock[] = [fixed];
  const moved = new Map<string, CanvasBlock>([[fixed.id, fixed]]);
  const others = blocks.filter((block) => block.id !== fixedId).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const original of others) {
    const block = { ...original };
    for (let guard = 0; guard < 500; guard++) {
      const hit = settled.find((other) => overlaps(block, other));
      if (!hit) break;
      block.y = hit.y + hit.h;
    }
    settled.push(block);
    moved.set(block.id, block);
  }
  return blocks.map((block) => moved.get(block.id) ?? block);
}

type Rect = { x: number; y: number; w: number; h: number };

export function isFree(blocks: CanvasBlock[], rect: Rect, ignoreId?: string): boolean {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > CANVAS_COLUMNS) return false;
  return !blocks.some((block) => block.id !== ignoreId && overlaps(rect, block));
}

/**
 * The best free spot that covers a cell: the wanted size if it fits there,
 * otherwise the largest size down to the smallest allowed. Of the spots that
 * fit, the one whose middle is nearest the cell wins, so the spot sits around
 * the pointer rather than off to one side of it.
 */
export function fitAt(
  blocks: CanvasBlock[],
  cell: { col: number; row: number },
  size: { w: number; h: number },
  min: { w: number; h: number } = { w: 1, h: 1 },
  ignoreId?: string
): Rect | null {
  if (!isFree(blocks, { x: cell.col, y: cell.row, w: 1, h: 1 }, ignoreId)) return null;
  const sizes: { w: number; h: number }[] = [];
  for (let h = size.h; h >= min.h; h -= 1) for (let w = size.w; w >= min.w; w -= 1) sizes.push({ w, h });
  sizes.sort((a, b) => b.w * b.h - a.w * a.h);
  for (const candidate of sizes) {
    let best: Rect | null = null;
    let bestDistance = Infinity;
    for (let x = cell.col - candidate.w + 1; x <= cell.col; x += 1) {
      for (let y = cell.row - candidate.h + 1; y <= cell.row; y += 1) {
        const rect = { x, y, ...candidate };
        if (!isFree(blocks, rect, ignoreId)) continue;
        const distance = Math.abs(x + candidate.w / 2 - (cell.col + 0.5)) + Math.abs(y + candidate.h / 2 - (cell.row + 0.5));
        if (distance < bestDistance) {
          best = rect;
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * A new block of a type. At a cell it takes the best free spot around that
 * cell, as large as its usual size allows. Where not even its smallest size
 * fits, it goes there anyway and pushes what it lands on down. Without a cell
 * it goes below everything else.
 */
export function placeBlock(
  blocks: CanvasBlock[],
  type: CanvasBlockType,
  at: { col: number; row: number } | Rect | null,
  deviceId: string
): { blocks: CanvasBlock[]; id: string } {
  const info = CANVAS_BLOCK_INFO[type];
  const id = newBlockId();
  let rect: Rect;
  if (!at) {
    rect = { x: 0, y: bottomOf(blocks), w: info.w, h: info.h };
  } else if ("w" in at && isFree(blocks, at)) {
    rect = at;
  } else {
    const cell = "col" in at ? at : { col: at.x, row: at.y };
    rect =
      fitAt(blocks, cell, { w: info.w, h: info.h }, { w: Math.min(info.minW, CANVAS_COLUMNS), h: info.minH }) ?? {
        x: Math.max(0, Math.min(cell.col, CANVAS_COLUMNS - info.minW)),
        y: cell.row,
        w: info.minW,
        h: info.minH,
      };
  }
  const block = clampBlock(newCanvasBlock(type, id, rect, deviceId));
  return { blocks: makeRoom([...blocks, block], id), id };
}

/**
 * Moves a block by whole cells within the page. Whatever it lands on moves
 * down to make room, the same as when it is dragged there.
 */
export function nudge(blocks: CanvasBlock[], id: string, dx: number, dy: number): CanvasBlock[] | null {
  const block = blocks.find((entry) => entry.id === id);
  if (!block) return null;
  const x = block.x + dx;
  const y = block.y + dy;
  if (x < 0 || y < 0 || x + block.w > CANVAS_COLUMNS) return null;
  return makeRoom(
    blocks.map((entry) => (entry.id === id ? { ...entry, x, y } : entry)),
    id
  );
}

/* --------------------------------------------------------------- templates */

export const CANVAS_TEMPLATES = [
  { id: "blank", label: "Blank page", description: "Start from an empty grid.", needsDevice: false },
  { id: "server", label: "Server overview", description: "Every key number and chart for one device.", needsDevice: true },
  { id: "status", label: "Status page", description: "Online status, uptime history and alerts for your fleet.", needsDevice: false },
  { id: "wall", label: "Fleet wall", description: "Fleet totals and every device side by side, for a TV.", needsDevice: false },
] as const;

export type CanvasTemplateId = (typeof CANVAS_TEMPLATES)[number]["id"];

export function templateContent(template: CanvasTemplateId, title: string, device: CanvasDeviceMeta | null): CanvasContent {
  const content = emptyCanvasContent(title);
  const blocks: CanvasBlock[] = [];
  const deviceId = device?.id ?? "";
  const add = (type: CanvasBlockType, at: { x: number; y: number; w?: number; h?: number }, change?: (block: CanvasBlock) => void) => {
    const block = newCanvasBlock(type, newBlockId(), at, deviceId);
    change?.(block);
    blocks.push(block);
    return block;
  };
  const metric = (block: CanvasBlock, id: string, label: string) => {
    if (block.type === "chart" || block.type === "value" || block.type === "gauge") {
      block.config.source = { ...block.config.source, metric: id };
      block.title = label;
      if (block.type !== "chart") block.config.thresholds = defaultThresholds(canvasMetric(id));
    }
  };
  const fleet = (block: CanvasBlock, agg: "sum" | "avg", split = false) => {
    if (block.type === "chart" || block.type === "value" || block.type === "gauge") {
      const source: CanvasSource = { ...block.config.source, target: { kind: "fleet", select: { mode: "all", tag: "", ids: [] }, agg, split } };
      block.config.source = source;
    }
  };

  if (template === "server") {
    add("heading", { x: 0, y: 0, w: 24, h: 2 }, (block) => {
      if (block.type === "heading") block.config.text = device?.name ?? "Server";
    });
    add("status", { x: 0, y: 2, w: 6, h: 4 }, (block) => (block.title = ""));
    add("value", { x: 6, y: 2, w: 6, h: 4 }, (block) => metric(block, "cpu", "CPU"));
    add("value", { x: 12, y: 2, w: 6, h: 4 }, (block) => metric(block, "memory", "Memory"));
    add("value", { x: 18, y: 2, w: 6, h: 4 }, (block) => metric(block, "diskSpace", "Disk"));
    add("chart", { x: 0, y: 6, w: 12, h: 8 }, (block) => metric(block, "cpu", "CPU usage"));
    add("chart", { x: 12, y: 6, w: 12, h: 8 }, (block) => metric(block, "memory", "Memory usage"));
    add("chart", { x: 0, y: 14, w: 12, h: 8 }, (block) => metric(block, "network", "Network"));
    add("chart", { x: 12, y: 14, w: 12, h: 8 }, (block) => metric(block, "load", "Load average"));
    add("info", { x: 0, y: 22, w: 12, h: 7 });
    add("volumes", { x: 12, y: 22, w: 12, h: 7 });
  } else if (template === "status") {
    // The page's own title bar carries the name, so the blocks start straight away.
    content.description = "Live availability of our machines.";
    const fleetWide = (block: CanvasBlock) => {
      if (block.type === "status" || block.type === "alerts" || block.type === "uptime") block.config.select = { mode: "all", tag: "", ids: [] };
    };
    add("status", { x: 0, y: 0, w: 12, h: 8 }, fleetWide);
    add("alerts", { x: 12, y: 0, w: 12, h: 8 }, fleetWide);
    add("uptime", { x: 0, y: 8, w: 24, h: 10 }, fleetWide);
  } else if (template === "wall") {
    content.options.maxWidth = 0;
    content.options.showHeader = false;
    add("clock", { x: 0, y: 0, w: 6, h: 4 });
    add("value", { x: 6, y: 0, w: 6, h: 4 }, (block) => {
      metric(block, "cpu", "Average CPU");
      fleet(block, "avg");
    });
    add("value", { x: 12, y: 0, w: 6, h: 4 }, (block) => {
      metric(block, "memory", "Average memory");
      fleet(block, "avg");
    });
    add("value", { x: 18, y: 0, w: 6, h: 4 }, (block) => {
      metric(block, "network", "Total download");
      fleet(block, "sum");
      if (block.type === "value") block.config.source.field = "netRxBps";
    });
    add("chart", { x: 0, y: 4, w: 12, h: 9 }, (block) => {
      metric(block, "cpu", "CPU by device");
      fleet(block, "avg", true);
    });
    add("chart", { x: 12, y: 4, w: 12, h: 9 }, (block) => {
      metric(block, "memory", "Memory by device");
      fleet(block, "avg", true);
    });
    add("devices", { x: 0, y: 13, w: 24, h: 9 });
  }

  content.blocks = blocks;
  return content;
}
