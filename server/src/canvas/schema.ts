import { z } from "zod";
import {
  CANVAS_BLOCK_INFO,
  CANVAS_CARD_METRICS,
  CANVAS_COLORS,
  CANVAS_COLUMNS,
  CANVAS_INFO_FIELDS,
  CANVAS_MAX_BLOCKS,
  CANVAS_MAX_ROWS,
  CANVAS_RANGE_SECONDS,
  CANVAS_WIDTHS,
  canvasMetric,
} from "@beacon/shared";
import type { CanvasContent } from "@beacon/shared";

/*
 * Everything an admin saves is checked here, since a published page is read
 * by strangers. Text is only ever rendered as text, so the limits are about
 * size, and the ids and keys are checked against what the hub knows.
 */

const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const text = (max: number) => z.string().max(max);
const range = z
  .number()
  .int()
  .refine((value) => CANVAS_RANGE_SECONDS.includes(value), "is not a range a chart can show");
const optionalRange = range.nullable();

const selector = z.object({
  mode: z.enum(["all", "tag", "pick"]),
  tag: text(60),
  ids: z.array(id).max(200),
});

const thresholds = z.object({
  warn: z.number().finite().nullable(),
  crit: z.number().finite().nullable(),
  below: z.boolean(),
});

const source = z
  .object({
    metric: text(40),
    field: text(40),
    sub: text(200),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("device"), deviceId: z.union([id, z.literal("")]) }),
      z.object({
        kind: z.literal("fleet"),
        select: selector,
        agg: z.enum(["sum", "avg", "max", "min"]),
        split: z.boolean(),
      }),
    ]),
  })
  .superRefine((value, context) => {
    const metric = canvasMetric(value.metric);
    if (!metric) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "is not a known metric", path: ["metric"] });
      return;
    }
    if (value.field && !metric.fields.some((field) => field.key === value.field)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "is not a field of this metric", path: ["field"] });
    }
    if (metric.scope === "gpu" && value.sub !== "" && !/^\d{1,2}$/.test(value.sub)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "is not a GPU position", path: ["sub"] });
    }
  });

const align = z.enum(["left", "center", "right"]);
const deviceRef = z.union([id, z.literal("")]);

function block<T extends string, C extends z.ZodTypeAny>(type: T, config: C) {
  return z.object({
    id,
    type: z.literal(type),
    x: z.number().int().min(0).max(CANVAS_COLUMNS - 1),
    y: z.number().int().min(0).max(CANVAS_MAX_ROWS),
    w: z.number().int().min(1).max(CANVAS_COLUMNS),
    h: z.number().int().min(1).max(60),
    title: text(120),
    frame: z.boolean(),
    config,
  });
}

const blockSchema = z
  .discriminatedUnion("type", [
    block("heading", z.object({ text: text(200), subtitle: text(300), size: z.enum(["sm", "md", "lg", "xl"]), align })),
    block("text", z.object({ text: text(4000), size: z.enum(["sm", "md", "lg"]), align })),
    block("divider", z.object({ label: text(80) })),
    block("spacer", z.object({}).strict()),
    block(
      "chart",
      z.object({
        source,
        range: optionalRange,
        color: z.enum(CANVAS_COLORS),
        legend: z.boolean(),
        showValue: z.boolean(),
        alerts: z.boolean(),
      })
    ),
    block("value", z.object({ source, sparkline: z.boolean(), range: optionalRange, thresholds, caption: text(120) })),
    block(
      "gauge",
      z.object({ source, style: z.enum(["ring", "bar"]), thresholds, max: z.number().finite().positive().nullable() })
    ),
    block("status", z.object({ select: selector })),
    block("info", z.object({ deviceId: deviceRef, fields: z.array(z.enum(CANVAS_INFO_FIELDS)).max(CANVAS_INFO_FIELDS.length) })),
    block("volumes", z.object({ deviceId: deviceRef })),
    block("containers", z.object({ deviceId: deviceRef, runningOnly: z.boolean() })),
    block("cores", z.object({ deviceId: deviceRef, style: z.enum(["heatmap", "bars"]), range: optionalRange })),
    block(
      "devices",
      z.object({ select: selector, metrics: z.array(z.enum(CANVAS_CARD_METRICS)).max(CANVAS_CARD_METRICS.length) })
    ),
    block("uptime", z.object({ select: selector, days: z.union([z.literal(30), z.literal(60), z.literal(90)]) })),
    block("alerts", z.object({ select: selector, limit: z.number().int().min(1).max(50) })),
    block(
      "clock",
      z.object({
        timeZone: text(64).refine((zone) => zone === "" || validTimeZone(zone), "is not a time zone"),
        hour12: z.boolean(),
        seconds: z.boolean(),
        showDate: z.boolean(),
      })
    ),
  ])
  .superRefine((value, context) => {
    if (value.x + value.w > CANVAS_COLUMNS) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "runs past the right edge of the page", path: ["w"] });
    }
    const info = CANVAS_BLOCK_INFO[value.type];
    if (value.w < Math.min(info.minW, CANVAS_COLUMNS) || value.h < info.minH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "is smaller than this block allows", path: ["w"] });
    }
    if (value.w > info.maxW || value.h > info.maxH) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "is larger than this block allows", path: ["w"] });
    }
  });

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const contentSchema = z
  .object({
    title: text(120).transform((value) => value.trim() || "Untitled page"),
    description: text(500),
    options: z.object({
      defaultRange: range,
      visitorRanges: z.array(range).max(CANVAS_RANGE_SECONDS.length),
      maxWidth: z
        .number()
        .int()
        .refine((value) => (CANVAS_WIDTHS as readonly number[]).includes(value), "is not a page width"),
      showHeader: z.boolean(),
      showUpdated: z.boolean(),
      unitBase: z.union([z.literal(1000), z.literal(1024)]),
      temperatureUnit: z.enum(["c", "f"]),
    }),
    blocks: z.array(blockSchema).max(CANVAS_MAX_BLOCKS),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const entry of value.blocks) {
      if (seen.has(entry.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, message: `has two blocks with the id ${entry.id}`, path: ["blocks"] });
        return;
      }
      seen.add(entry.id);
    }
  });

export function parseContent(input: unknown): { ok: true; content: CanvasContent } | { ok: false; error: string } {
  const result = contentSchema.safeParse(input);
  if (result.success) return { ok: true, content: result.data as CanvasContent };
  const first = result.error.issues[0];
  return { ok: false, error: first ? `${first.path.join(".") || "page"}: ${first.message}` : "The page is not valid." };
}

export const blockOnlySchema = blockSchema;
