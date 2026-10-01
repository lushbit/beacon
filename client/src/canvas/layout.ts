import type { CanvasBlock, CanvasBlockType, CanvasContent, CanvasDeviceMeta } from "@beacon/shared";
import {
  CANVAS_BLOCK_INFO,
  CANVAS_COLUMNS,
  canvasMetric,
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

/**
 * Slides every block up as far as it goes, keeping the order. The editor's grid
 * packs the same way, so the stored page always matches what the editor shows.
 */
export function tidyUp(blocks: CanvasBlock[]): CanvasBlock[] {
  const placed: CanvasBlock[] = [];
  for (const original of blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x)) {
    const block = { ...original };
    while (block.y > 0 && !placed.some((other) => overlaps({ ...block, y: block.y - 1 }, other))) block.y -= 1;
    placed.push(block);
  }
  const byId = new Map(placed.map((block) => [block.id, block]));
  return blocks.map((block) => byId.get(block.id) ?? block);
}

/** A new block of a type at a spot, cut to fit the page and with room made for it. */
export function placeBlock(
  blocks: CanvasBlock[],
  type: CanvasBlockType,
  at: { x: number; y: number; w?: number; h?: number } | null,
  deviceId: string
): { blocks: CanvasBlock[]; id: string } {
  const info = CANVAS_BLOCK_INFO[type];
  const x = at ? Math.min(at.x, CANVAS_COLUMNS - info.minW) : 0;
  const y = at ? at.y : bottomOf(blocks);
  const w = Math.max(info.minW, Math.min(at?.w ?? info.w, CANVAS_COLUMNS - x));
  const h = Math.max(info.minH, at?.h ?? info.h);
  const id = newBlockId();
  const block = newCanvasBlock(type, id, { x, y, w, h }, deviceId);
  return { blocks: tidyUp(makeRoom([...blocks, block], id)), id };
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
