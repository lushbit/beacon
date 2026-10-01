import { useMemo } from "react";
import { AlignCenter, AlignLeft, AlignRight, Copy, Trash2 } from "lucide-react";
import type {
  CanvasBlock,
  CanvasBlockOf,
  CanvasColor,
  CanvasContent,
  CanvasDeviceMeta,
  CanvasDeviceSnapshot,
  CanvasOptions,
  CanvasSource,
} from "@beacon/shared";
import {
  CANVAS_BLOCK_INFO,
  CANVAS_CARD_METRICS,
  CANVAS_COLORS,
  CANVAS_COLUMNS,
  CANVAS_INFO_FIELDS,
  CANVAS_INFO_LABELS,
  CANVAS_METRICS,
  CANVAS_RANGES,
  CANVAS_WIDTHS,
  canvasMetric,
  clampBlock,
  defaultThresholds,
} from "@beacon/shared";
import { CommandSteps } from "@/components/CommandSteps";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { CANVAS_COLOR_LABELS, CANVAS_COLOR_VALUES } from "../format";
import { BLOCK_ICONS } from "./BlockLibrary";
import { DevicePicker, NativeSelect, NumberInput, Row, Section, SelectorField, Segmented, ThresholdsField, Toggle } from "./fields";

type Change = (block: CanvasBlock, group?: string) => void;

const ALIGN_OPTIONS = [
  { value: "left" as const, label: <AlignLeft className="h-3.5 w-3.5" />, title: "Left" },
  { value: "center" as const, label: <AlignCenter className="h-3.5 w-3.5" />, title: "Centre" },
  { value: "right" as const, label: <AlignRight className="h-3.5 w-3.5" />, title: "Right" },
];

const CARD_METRIC_LABELS: Record<(typeof CANVAS_CARD_METRICS)[number], string> = {
  cpu: "CPU",
  memory: "Memory",
  disk: "Disk",
  network: "Network",
  temperature: "Temperature",
  uptime: "Uptime",
};

const METRIC_GROUPS = [...new Set(CANVAS_METRICS.map((metric) => metric.group))];

function RangeSelect({ value, onChange, followLabel }: { value: number | null; onChange: (value: number | null) => void; followLabel: string }) {
  return (
    <NativeSelect value={value === null ? "" : String(value)} onChange={(text) => onChange(text === "" ? null : Number(text))} label="Range">
      <option value="">{followLabel}</option>
      {CANVAS_RANGES.map((range) => (
        <option key={range.seconds} value={range.seconds}>
          Always {range.label}
        </option>
      ))}
    </NativeSelect>
  );
}

/* ------------------------------------------------------------------ source */

function SourceEditor({
  source,
  onChange,
  devices,
  snapshots,
  kind,
}: {
  source: CanvasSource;
  onChange: (source: CanvasSource, group?: string) => void;
  devices: CanvasDeviceMeta[];
  snapshots: Record<string, CanvasDeviceSnapshot>;
  kind: "chart" | "single";
}) {
  const metric = canvasMetric(source.metric);
  const target = source.target;
  const snapshot = target.kind === "device" ? snapshots[target.deviceId] : undefined;

  const subOptions = useMemo(() => {
    if (!metric || target.kind !== "device") return null;
    if (metric.scope === "gpu") {
      return {
        all: "Main GPU",
        items: (snapshot?.gpus ?? []).map((gpu) => ({ value: String(gpu.index), label: gpu.name })),
      };
    }
    if (metric.scope === "drive") {
      return {
        all: metric.id === "diskTemp" ? "Hottest drive" : "All drives",
        items: (snapshot?.drives ?? []).map((drive) => ({ value: drive.device, label: drive.name === drive.device ? drive.device : `${drive.name} (${drive.device})` })),
      };
    }
    if (metric.scope === "iface") {
      return { all: "All interfaces", items: (snapshot?.ifaces ?? []).map((entry) => ({ value: entry.iface, label: entry.iface })) };
    }
    return null;
  }, [metric, target, snapshot]);

  return (
    <div className="space-y-3">
      <Row label="Show data from">
        <Segmented
          label="Show data from"
          value={target.kind}
          onChange={(value) =>
            onChange({
              ...source,
              sub: "",
              target:
                value === "device"
                  ? { kind: "device", deviceId: devices[0]?.id ?? "" }
                  : { kind: "fleet", select: { mode: "all", tag: "", ids: [] }, agg: metric?.unit === "percent" ? "avg" : "sum", split: false },
            })
          }
          options={[
            { value: "device", label: "One device" },
            { value: "fleet", label: "Several devices" },
          ]}
        />
      </Row>

      {target.kind === "device" ? (
        <Row label="Device">
          <DevicePicker devices={devices} value={target.deviceId} onChange={(deviceId) => onChange({ ...source, sub: "", target: { ...target, deviceId } })} />
        </Row>
      ) : (
        <>
          <Row label="Devices">
            <SelectorField devices={devices} value={target.select} onChange={(select) => onChange({ ...source, target: { ...target, select } })} />
          </Row>
          {kind === "chart" ? (
            <Toggle
              label="One line per device"
              hint="Compares devices instead of combining them."
              checked={target.split}
              onChange={(split) => onChange({ ...source, target: { ...target, split } })}
            />
          ) : null}
          {kind === "single" || !target.split ? (
            <Row label="Combine them as">
              <Segmented
                label="Combine them as"
                value={target.agg}
                onChange={(agg) => onChange({ ...source, target: { ...target, agg } })}
                options={[
                  { value: "sum", label: "Total" },
                  { value: "avg", label: "Average" },
                  { value: "max", label: "Highest" },
                  { value: "min", label: "Lowest" },
                ]}
              />
            </Row>
          ) : null}
        </>
      )}

      <Row label="Metric">
        <NativeSelect value={source.metric} onChange={(value) => onChange({ ...source, metric: value, field: "", sub: "" }, "metric")} label="Metric">
          {METRIC_GROUPS.map((group) => (
            <optgroup key={group} label={group}>
              {CANVAS_METRICS.filter((entry) => entry.group === group && (kind === "single" || entry.chart)).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>
      </Row>

      {metric && metric.fields.length > 1 ? (
        <Row label={kind === "chart" ? "Lines" : "Value"}>
          <NativeSelect value={source.field} onChange={(field) => onChange({ ...source, field })} label="Field">
            {kind === "chart" ? <option value="">All of them</option> : null}
            {metric.fields.map((field, index) => (
              <option key={field.key} value={kind === "single" && index === 0 ? "" : field.key}>
                {field.label}
              </option>
            ))}
          </NativeSelect>
        </Row>
      ) : null}

      {subOptions ? (
        <Row label={metric?.scope === "gpu" ? "GPU" : metric?.scope === "drive" ? "Drive" : "Interface"}>
          <NativeSelect value={source.sub} onChange={(sub) => onChange({ ...source, sub })} label="Part">
            <option value="">{subOptions.all}</option>
            {subOptions.items.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </NativeSelect>
        </Row>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------- block forms */

function BlockSettings({
  block,
  onChange,
  devices,
  snapshots,
}: {
  block: CanvasBlock;
  onChange: Change;
  devices: CanvasDeviceMeta[];
  snapshots: Record<string, CanvasDeviceSnapshot>;
}) {
  const set = <T extends CanvasBlock>(current: T, config: Partial<T["config"]>, group?: string) =>
    onChange({ ...current, config: { ...current.config, ...config } } as CanvasBlock, group);

  /** Changing the metric of a number also resets its limits and, while untouched, its title. */
  const withSource = (current: CanvasBlockOf<"chart"> | CanvasBlockOf<"value"> | CanvasBlockOf<"gauge">, source: CanvasSource, group?: string) => {
    const before = canvasMetric(current.config.source.metric);
    const after = canvasMetric(source.metric);
    const metricChanged = before?.id !== after?.id;
    const next = { ...current, config: { ...current.config, source } } as typeof current;
    if (metricChanged && after) {
      if (!current.title || current.title === before?.label) next.title = after.label;
      if (next.type !== "chart") (next as CanvasBlockOf<"value">).config.thresholds = defaultThresholds(after);
    }
    onChange(next as CanvasBlock, group);
  };

  switch (block.type) {
    case "heading":
      return (
        <>
          <Row label="Text">
            <Input value={block.config.text} maxLength={200} onChange={(event) => set(block, { text: event.target.value }, "text")} />
          </Row>
          <Row label="Subtitle">
            <Input value={block.config.subtitle} maxLength={300} placeholder="Optional" onChange={(event) => set(block, { subtitle: event.target.value }, "subtitle")} />
          </Row>
          <Row label="Size">
            <Segmented
              label="Size"
              value={block.config.size}
              onChange={(size) => set(block, { size })}
              options={[
                { value: "sm", label: "S" },
                { value: "md", label: "M" },
                { value: "lg", label: "L" },
                { value: "xl", label: "XL" },
              ]}
            />
          </Row>
          <Row label="Alignment">
            <Segmented label="Alignment" value={block.config.align} onChange={(align) => set(block, { align })} options={ALIGN_OPTIONS} />
          </Row>
        </>
      );
    case "text":
      return (
        <>
          <Row label="Text" hint="**bold**, *italics*, `code`, [a link](https://example.com) and lines starting with - for a list.">
            <Textarea rows={7} maxLength={4000} value={block.config.text} onChange={(event) => set(block, { text: event.target.value }, "text")} />
          </Row>
          <Row label="Size">
            <Segmented
              label="Size"
              value={block.config.size}
              onChange={(size) => set(block, { size })}
              options={[
                { value: "sm", label: "Small" },
                { value: "md", label: "Medium" },
                { value: "lg", label: "Large" },
              ]}
            />
          </Row>
          <Row label="Alignment">
            <Segmented label="Alignment" value={block.config.align} onChange={(align) => set(block, { align })} options={ALIGN_OPTIONS} />
          </Row>
        </>
      );
    case "divider":
      return (
        <Row label="Label">
          <Input value={block.config.label} maxLength={80} placeholder="Optional" onChange={(event) => set(block, { label: event.target.value }, "label")} />
        </Row>
      );
    case "spacer":
      return <p className="text-xs text-muted-foreground">Keeps space free between blocks. Visitors only see the gap.</p>;
    case "chart": {
      const metric = canvasMetric(block.config.source.metric);
      const single = block.config.source.field !== "" || (metric?.fields.length ?? 1) === 1 || (block.config.source.target.kind === "fleet" && block.config.source.target.split);
      return (
        <>
          <SourceEditor source={block.config.source} onChange={(source, group) => withSource(block, source, group)} devices={devices} snapshots={snapshots} kind="chart" />
          <Row label="Time range">
            <RangeSelect value={block.config.range} onChange={(range) => set(block, { range })} followLabel="Follow the page" />
          </Row>
          {single && !(block.config.source.target.kind === "fleet" && block.config.source.target.split) ? (
            <Row label="Colour">
              <div className="flex flex-wrap gap-1.5">
                {CANVAS_COLORS.map((color: CanvasColor) => (
                  <button
                    key={color}
                    type="button"
                    title={CANVAS_COLOR_LABELS[color]}
                    aria-label={CANVAS_COLOR_LABELS[color]}
                    aria-pressed={block.config.color === color}
                    onClick={() => set(block, { color })}
                    className={cn(
                      "h-7 w-7 rounded-full border-2 transition-transform hover:scale-110",
                      block.config.color === color ? "border-foreground" : "border-transparent"
                    )}
                    style={{ background: CANVAS_COLOR_VALUES[color] }}
                  />
                ))}
              </div>
            </Row>
          ) : null}
          {!single || (block.config.source.target.kind === "fleet" && block.config.source.target.split) ? (
            <Toggle label="Legend" hint="Names each line above the chart." checked={block.config.legend} onChange={(legend) => set(block, { legend })} />
          ) : null}
          <Toggle label="Current value" hint="Shown in the top corner." checked={block.config.showValue} onChange={(showValue) => set(block, { showValue })} />
          <Toggle label="Alert markers" hint="A line where an alert started." checked={block.config.alerts} onChange={(alerts) => set(block, { alerts })} />
        </>
      );
    }
    case "value": {
      const metric = canvasMetric(block.config.source.metric);
      return (
        <>
          <SourceEditor source={block.config.source} onChange={(source, group) => withSource(block, source, group)} devices={devices} snapshots={snapshots} kind="single" />
          <Row label="Caption" hint="Shown under the number. Empty shows the device name.">
            <Input value={block.config.caption} maxLength={120} placeholder="Automatic" onChange={(event) => set(block, { caption: event.target.value }, "caption")} />
          </Row>
          {metric?.chart ? (
            <>
              <Toggle label="Trend line" checked={block.config.sparkline} onChange={(sparkline) => set(block, { sparkline })} />
              {block.config.sparkline ? (
                <Row label="Trend range">
                  <RangeSelect value={block.config.range} onChange={(range) => set(block, { range })} followLabel="Follow the page" />
                </Row>
              ) : null}
            </>
          ) : null}
          <Row label="Colour limits">
            <ThresholdsField value={block.config.thresholds} onChange={(thresholds) => set(block, { thresholds }, "thresholds")} unit={metric?.unit} />
          </Row>
        </>
      );
    }
    case "gauge": {
      const metric = canvasMetric(block.config.source.metric);
      return (
        <>
          <SourceEditor source={block.config.source} onChange={(source, group) => withSource(block, source, group)} devices={devices} snapshots={snapshots} kind="single" />
          <Row label="Style">
            <Segmented
              label="Style"
              value={block.config.style}
              onChange={(style) => set(block, { style })}
              options={[
                { value: "ring", label: "Dial" },
                { value: "bar", label: "Bar" },
              ]}
            />
          </Row>
          <Row label="Full at" hint={metric?.max ? `Empty uses ${metric.max}.` : "The value of a full gauge. Empty uses 100."}>
            <NumberInput label="Full at" value={block.config.max} onChange={(max) => set(block, { max: max !== null && max > 0 ? max : null }, "max")} placeholder="Automatic" />
          </Row>
          <Row label="Colour limits">
            <ThresholdsField value={block.config.thresholds} onChange={(thresholds) => set(block, { thresholds }, "thresholds")} unit={metric?.unit} />
          </Row>
        </>
      );
    }
    case "status":
      return (
        <Row label="Devices">
          <SelectorField devices={devices} value={block.config.select} onChange={(select) => set(block, { select })} />
        </Row>
      );
    case "info":
      return (
        <>
          <Row label="Device">
            <DevicePicker devices={devices} value={block.config.deviceId} onChange={(deviceId) => set(block, { deviceId })} />
          </Row>
          <Row label="Show" hint="Hostnames, serial numbers and addresses are never shown.">
            <div className="grid grid-cols-1 gap-1">
              {CANVAS_INFO_FIELDS.map((field) => {
                const checked = block.config.fields.includes(field);
                return (
                  <label key={field} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="accent-white"
                      checked={checked}
                      onChange={() =>
                        set(block, {
                          fields: checked
                            ? block.config.fields.filter((entry) => entry !== field)
                            : CANVAS_INFO_FIELDS.filter((entry) => entry === field || block.config.fields.includes(entry)),
                        })
                      }
                    />
                    {CANVAS_INFO_LABELS[field]}
                  </label>
                );
              })}
            </div>
          </Row>
        </>
      );
    case "volumes":
      return (
        <Row label="Device" hint="Volumes hidden in the device settings stay hidden.">
          <DevicePicker devices={devices} value={block.config.deviceId} onChange={(deviceId) => set(block, { deviceId })} />
        </Row>
      );
    case "containers":
      return (
        <>
          <Row label="Device">
            <DevicePicker devices={devices} value={block.config.deviceId} onChange={(deviceId) => set(block, { deviceId })} />
          </Row>
          <Toggle label="Running containers only" checked={block.config.runningOnly} onChange={(runningOnly) => set(block, { runningOnly })} />
        </>
      );
    case "cores":
      return (
        <>
          <Row label="Device">
            <DevicePicker devices={devices} value={block.config.deviceId} onChange={(deviceId) => set(block, { deviceId })} />
          </Row>
          <Row label="Style">
            <Segmented
              label="Style"
              value={block.config.style}
              onChange={(style) => set(block, { style })}
              options={[
                { value: "heatmap", label: "Over time" },
                { value: "bars", label: "Right now" },
              ]}
            />
          </Row>
          {block.config.style === "heatmap" ? (
            <Row label="Time range">
              <RangeSelect value={block.config.range} onChange={(range) => set(block, { range })} followLabel="Follow the page" />
            </Row>
          ) : null}
        </>
      );
    case "devices":
      return (
        <>
          <Row label="Devices" hint="New devices get a card automatically.">
            <SelectorField devices={devices} value={block.config.select} onChange={(select) => set(block, { select })} />
          </Row>
          <Row label="On each card">
            <div className="grid grid-cols-2 gap-1">
              {CANVAS_CARD_METRICS.map((metric) => {
                const checked = block.config.metrics.includes(metric);
                return (
                  <label key={metric} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="checkbox"
                      className="accent-white"
                      checked={checked}
                      onChange={() =>
                        set(block, {
                          metrics: checked
                            ? block.config.metrics.filter((entry) => entry !== metric)
                            : CANVAS_CARD_METRICS.filter((entry) => entry === metric || block.config.metrics.includes(entry)),
                        })
                      }
                    />
                    {CARD_METRIC_LABELS[metric]}
                  </label>
                );
              })}
            </div>
          </Row>
        </>
      );
    case "uptime":
      return (
        <>
          <Row label="Devices">
            <SelectorField devices={devices} value={block.config.select} onChange={(select) => set(block, { select })} />
          </Row>
          <Row label="Days" hint="History older than the retention setting has no bars.">
            <Segmented
              label="Days"
              value={block.config.days}
              onChange={(days) => set(block, { days })}
              options={[
                { value: 30 as const, label: "30" },
                { value: 60 as const, label: "60" },
                { value: 90 as const, label: "90" },
              ]}
            />
          </Row>
        </>
      );
    case "alerts":
      return (
        <>
          <Row label="Devices">
            <SelectorField devices={devices} value={block.config.select} onChange={(select) => set(block, { select })} />
          </Row>
          <Row label="Show at most">
            <NumberInput label="Show at most" value={block.config.limit} min={1} max={50} onChange={(limit) => set(block, { limit: Math.max(1, Math.min(50, Math.round(limit ?? 8))) }, "limit")} />
          </Row>
        </>
      );
    case "clock": {
      const zones: string[] = (() => {
        try {
          return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
        } catch {
          return [];
        }
      })();
      return (
        <>
          <Row label="Time zone">
            {zones.length > 0 ? (
              <NativeSelect value={block.config.timeZone} onChange={(timeZone) => set(block, { timeZone })} label="Time zone">
                <option value="">The visitor's own</option>
                {zones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace(/_/g, " ")}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <Input value={block.config.timeZone} placeholder="Europe/Berlin" onChange={(event) => set(block, { timeZone: event.target.value }, "zone")} />
            )}
          </Row>
          <Toggle label="12-hour clock" checked={block.config.hour12} onChange={(hour12) => set(block, { hour12 })} />
          <Toggle label="Seconds" checked={block.config.seconds} onChange={(seconds) => set(block, { seconds })} />
          <Toggle label="Date" checked={block.config.showDate} onChange={(showDate) => set(block, { showDate })} />
        </>
      );
    }
  }
}

/* --------------------------------------------------------------- inspector */

export function BlockInspector({
  block,
  onChange,
  onDuplicate,
  onDelete,
  devices,
  snapshots,
  pageUrl,
  badges,
}: {
  block: CanvasBlock;
  onChange: Change;
  onDuplicate: () => void;
  onDelete: () => void;
  devices: CanvasDeviceMeta[];
  snapshots: Record<string, CanvasDeviceSnapshot>;
  /** The live page's address with any key it needs, once published. */
  pageUrl: string | null;
  badges: boolean;
}) {
  const info = CANVAS_BLOCK_INFO[block.type];
  const Icon = BLOCK_ICONS[block.type];
  const embedUrl = pageUrl ? pageUrl.replace(/(\?|$)/, `/b/${block.id}$1`) : null;
  const badgeUrl =
    pageUrl && badges && (block.type === "value" || block.type === "gauge" || block.type === "status")
      ? pageUrl.replace(/(\?|$)/, `/badge/${block.id}.svg$1`)
      : null;
  const titled = block.type !== "spacer" && block.type !== "divider" && block.type !== "heading";

  return (
    <div>
      <Section
        title="Content"
        action={
          <span className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onDuplicate} title="Duplicate (Ctrl+D)" aria-label="Duplicate block">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 hover:text-danger" onClick={onDelete} title="Delete (Del)" aria-label="Delete block">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </span>
        }
      >
        <p className="-mt-1 flex items-start gap-2 text-2xs text-muted-foreground">
          <Icon className="mt-px h-3.5 w-3.5 shrink-0" />
          {info.description}
        </p>
        {titled ? (
          <Row label="Title" hint={block.type === "value" || block.type === "gauge" ? "Empty uses the metric name." : "Empty hides the title."}>
            <Input value={block.title} maxLength={120} placeholder="No title" onChange={(event) => onChange({ ...block, title: event.target.value }, "title")} />
          </Row>
        ) : null}
        <BlockSettings block={block} onChange={onChange} devices={devices} snapshots={snapshots} />
      </Section>

      <Section title="Appearance">
        {block.type !== "spacer" ? (
          <Toggle label="Card background" hint="Off places the block directly on the page." checked={block.frame} onChange={(frame) => onChange({ ...block, frame })} />
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="text-2xs text-muted-foreground">Width (of {CANVAS_COLUMNS})</span>
            <NumberInput
              label="Width"
              value={block.w}
              min={info.minW}
              max={Math.min(info.maxW, CANVAS_COLUMNS)}
              onChange={(value) => onChange(clampBlock({ ...block, w: Math.round(value ?? block.w) }), "w")}
            />
          </label>
          <label className="space-y-1">
            <span className="text-2xs text-muted-foreground">Height (rows)</span>
            <NumberInput
              label="Height"
              value={block.h}
              min={info.minH}
              max={info.maxH}
              onChange={(value) => onChange(clampBlock({ ...block, h: Math.round(value ?? block.h) }), "h")}
            />
          </label>
        </div>
        <p className="text-2xs text-muted-foreground">
          {info.minW === info.maxW && info.minH === info.maxH
            ? "This block has a fixed size."
            : `Fits ${info.minW} to ${Math.min(info.maxW, CANVAS_COLUMNS)} wide and ${info.minH} to ${info.maxH} high. Drag the edges to resize.`}
        </p>
      </Section>

      {embedUrl && block.type !== "spacer" ? (
        <Section title="Embed">
          <p className="text-2xs text-muted-foreground">Embeds only this block. Allow embedding under Share first.</p>
          <CommandSteps steps={[{ command: `<iframe src="${embedUrl}" style="width:100%;height:${Math.max(160, block.h * 40)}px;border:0" loading="lazy"></iframe>` }]} />
          {badgeUrl ? (
            <>
              <p className="pt-1 text-2xs text-muted-foreground">Live badge image for a README or forum post.</p>
              <img src={badgeUrl} alt="" className="h-5" />
              <CommandSteps steps={[{ command: `![${block.title || "status"}](${badgeUrl})` }]} />
            </>
          ) : null}
        </Section>
      ) : null}
    </div>
  );
}

export function PageInspector({
  content,
  onChange,
}: {
  content: CanvasContent;
  onChange: (content: CanvasContent, group?: string) => void;
}) {
  const options = content.options;
  const setOptions = (patch: Partial<CanvasOptions>, group?: string) => onChange({ ...content, options: { ...options, ...patch } }, group);
  return (
    <div>
      <Section title="Page">
        <Row label="Title">
          <Input value={content.title} maxLength={120} onChange={(event) => onChange({ ...content, title: event.target.value }, "page-title")} />
        </Row>
        <Row label="Description" hint="Shown below the title.">
          <Textarea rows={3} maxLength={500} value={content.description} onChange={(event) => onChange({ ...content, description: event.target.value }, "page-description")} />
        </Row>
        <Toggle label="Title bar" hint="Title, description and time range buttons." checked={options.showHeader} onChange={(showHeader) => setOptions({ showHeader })} />
        <Toggle label="Live indicator" hint="A green dot with the time of the last update." checked={options.showUpdated} onChange={(showUpdated) => setOptions({ showUpdated })} />
      </Section>
      <Section title="Time">
        <Row label="Default time range">
          <NativeSelect value={String(options.defaultRange)} onChange={(value) => setOptions({ defaultRange: Number(value) })} label="Default range">
            {CANVAS_RANGES.map((range) => (
              <option key={range.seconds} value={range.seconds}>
                {range.label}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="Available time ranges" hint="Visitors switch between these. None hides the buttons.">
          <div className="flex flex-wrap gap-1.5">
            {CANVAS_RANGES.map((range) => {
              const on = options.visitorRanges.includes(range.seconds);
              return (
                <button
                  key={range.seconds}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setOptions({
                      visitorRanges: on
                        ? options.visitorRanges.filter((value) => value !== range.seconds)
                        : [...options.visitorRanges, range.seconds].sort((a, b) => a - b),
                    })
                  }
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                    on ? "border-foreground/40 bg-surface-3 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {range.label}
                </button>
              );
            })}
          </div>
        </Row>
      </Section>
      <Section title="Layout">
        <Row label="Page width" hint="Phones always get two columns.">
          <NativeSelect value={String(options.maxWidth)} onChange={(value) => setOptions({ maxWidth: Number(value) })} label="Page width">
            {CANVAS_WIDTHS.map((width) => (
              <option key={width} value={width}>
                {width === 0 ? "Fill the window" : `${width} pixels`}
              </option>
            ))}
          </NativeSelect>
        </Row>
        <Row label="Sizes in">
          <Segmented
            label="Sizes in"
            value={options.unitBase}
            onChange={(unitBase) => setOptions({ unitBase })}
            options={[
              { value: 1024 as const, label: "KiB, MiB" },
              { value: 1000 as const, label: "kB, MB" },
            ]}
          />
        </Row>
        <Row label="Temperatures in">
          <Segmented
            label="Temperatures in"
            value={options.temperatureUnit}
            onChange={(temperatureUnit) => setOptions({ temperatureUnit })}
            options={[
              { value: "c" as const, label: "°C" },
              { value: "f" as const, label: "°F" },
            ]}
          />
        </Row>
      </Section>
      <p className="px-4 pb-4 text-2xs text-muted-foreground">Click a block to change it.</p>
    </div>
  );
}
