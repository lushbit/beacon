import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, ChevronDown } from "lucide-react";
import {
  DEVICE_SORT_DIRECTION_LABELS,
  DEVICE_SORT_LABELS,
  type DeviceSort,
  type DeviceSummaryDto,
  type MetricSample,
  type MetricSummary,
  type SortDirection,
} from "@beacon/shared";
import { ChartLegend, TimeChart } from "@/components/charts/TimeChart";
import { RangePicker } from "@/components/device/RangePicker";
import { StatusDot } from "@/components/ui/misc";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useSeries } from "@/hooks/useSeries";
import { SERIES, LEVEL_FILL, deviceColor, levelOf } from "@/lib/colors";
import { formatDuration, formatPercent, formatRate, formatRelative, formatTemperature, platformName } from "@/lib/format";
import type { UnitBase } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Column {
  sort: DeviceSort;
  /** Tailwind classes that hold the column back until there is room for it. */
  visibility?: string;
  width?: string;
}

/**
 * Every column is its own sort control: the header cycles ascending →
 * descending → back to the natural order, so ordering lives where the values
 * are instead of in a separate menu above the list.
 */
const COLUMNS: Column[] = [
  { sort: "status", width: "w-[7rem]" },
  { sort: "name", width: "w-[18rem]" },
  { sort: "cpu", width: "w-[9rem]" },
  { sort: "memory", width: "w-[9rem]" },
  { sort: "disk", width: "w-[9rem]", visibility: "hidden md:table-cell" },
  { sort: "net", width: "w-[7rem]", visibility: "hidden lg:table-cell" },
  { sort: "temp", width: "w-[6rem]", visibility: "hidden xl:table-cell" },
  { sort: "uptime", width: "w-[7rem]", visibility: "hidden lg:table-cell" },
  { sort: "alerts", width: "w-[5.5rem]", visibility: "hidden 2xl:table-cell" },
  { sort: "agent", width: "w-[6rem]", visibility: "hidden 2xl:table-cell" },
];

/**
 * The sorts worth offering on a phone. The table's own headers are the sort
 * controls everywhere else, but the phone layout is a list of cards with no
 * headers to click, so it carries this row of buttons instead.
 */
const MOBILE_SORTS: DeviceSort[] = ["status", "name", "cpu", "memory", "disk"];

function MobileSortBar({
  sort,
  direction,
  onSort,
}: {
  sort: DeviceSort;
  direction: SortDirection;
  onSort: (sort: DeviceSort) => void;
}) {
  return (
    <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-2">
      {MOBILE_SORTS.map((option) => {
        const active = sort === option;
        const Arrow = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onSort(option)}
            aria-label={DEVICE_SORT_DIRECTION_LABELS[option][active && direction === "asc" ? "desc" : "asc"]}
            className={cn(
              "tap-target flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? "border-white/15 bg-white/[0.08] text-foreground"
                : "border-border/70 bg-card text-muted-foreground"
            )}
          >
            {DEVICE_SORT_LABELS[option]}
            <Arrow className="h-3 w-3" />
          </button>
        );
      })}
    </div>
  );
}

function SortHeader({
  column,
  active,
  direction,
  onSort,
}: {
  column: Column;
  active: boolean;
  direction: SortDirection;
  onSort: (sort: DeviceSort) => void;
}) {
  const label = DEVICE_SORT_LABELS[column.sort];
  const labels = DEVICE_SORT_DIRECTION_LABELS[column.sort];
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  const next = !active ? labels.asc : direction === "asc" ? labels.desc : "the default order";

  return (
    <th scope="col" className={cn("px-3 py-1.5 text-left font-normal", column.width, column.visibility)}>
      <button
        type="button"
        onClick={() => onSort(column.sort)}
        aria-pressed={active}
        title={`${active ? labels[direction] : `Not sorted by ${label.toLowerCase()}`} — click for ${next.toLowerCase()}`}
        className={cn(
          "group -mx-1.5 flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
          active ? "text-foreground" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
        )}
      >
        <span className="truncate">{label}</span>
        <Icon
          className={cn(
            "h-3 w-3 shrink-0 transition-opacity",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
          )}
        />
      </button>
    </th>
  );
}

/** The hostname, when the device has been given a different name to show. */
function otherHostname(device: DeviceSummaryDto): string | null {
  return device.hostname && device.hostname.toLowerCase() !== device.name.toLowerCase() ? device.hostname : null;
}

/** A number beside the same severity fill the meters use, so a hot value shows. */
function UsageCell({ value, compact }: { value: number | null | undefined; compact: boolean }) {
  const known = typeof value === "number" && Number.isFinite(value);
  const percent = known ? Math.max(0, Math.min(100, value)) : 0;
  const fill = LEVEL_FILL[levelOf(known ? value : null)];

  return (
    <div className="flex items-center gap-2.5">
      <span
        className={cn(
          "w-12 shrink-0 tabular",
          compact ? "text-xs" : "text-sm",
          known ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {known ? formatPercent(value, 1) : "—"}
      </span>
      <span
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: `color-mix(in srgb, ${fill} 22%, hsl(var(--surface-2)))` }}
        aria-hidden
      >
        <span
          className="block h-full rounded-full transition-[width] duration-500"
          style={{ width: `${percent}%`, background: fill }}
        />
      </span>
    </div>
  );
}

/** The expanded panel: the shape of the data without leaving the list. */
function RowDetail({ device, unitBase }: { device: DeviceSummaryDto; unitBase: UnitBase }) {
  const [range, setRange] = useState(3600);
  const usage = useSeries(device.id, range, ["cpuPct", "memPct"]);
  const network = useSeries(device.id, range, ["netRxBps", "netTxBps"]);

  // Single digits need a decimal to keep the axis labels apart; larger numbers
  // read better without one.
  const percent = (value: number) => formatPercent(value, value < 10 ? 1 : 0);

  const netSeries = [
    { key: "netRxBps", label: "Download", color: SERIES.in },
    { key: "netTxBps", label: "Upload", color: SERIES.out },
  ];

  return (
    <div className="space-y-3 border-t border-border/60 bg-surface/50 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Recent activity ·{" "}
          <Link to={`/devices/${device.id}`} className="text-foreground underline-offset-2 hover:underline">
            open the full view
          </Link>
        </p>
        <RangePicker value={range} onChange={setRange} />
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <div className="rounded-md border border-border/60 bg-card p-3">
          <p className="mb-1 text-xs font-medium text-foreground">CPU</p>
          <TimeChart
            points={usage.points}
            series={[{ key: "cpuPct", label: "CPU", color: SERIES.ink }]}
            from={usage.from}
            to={usage.to}
            format={percent}
            clampMax={100}
            height={150}
          />
        </div>

        <div className="rounded-md border border-border/60 bg-card p-3">
          <p className="mb-1 text-xs font-medium text-foreground">Memory</p>
          <TimeChart
            points={usage.points}
            series={[{ key: "memPct", label: "Memory", color: SERIES.ink }]}
            from={usage.from}
            to={usage.to}
            format={percent}
            clampMax={100}
            height={150}
          />
        </div>

        <div className="rounded-md border border-border/60 bg-card p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-foreground">Network</p>
            <ChartLegend series={netSeries} />
          </div>
          <TimeChart
            points={network.points}
            series={netSeries}
            from={network.from}
            to={network.to}
            format={(value) => formatRate(value, unitBase)}
            height={150}
          />
        </div>
      </div>
    </div>
  );
}

interface DeviceTableProps {
  devices: DeviceSummaryDto[];
  samples: Record<string, MetricSample | undefined>;
  isOnline: (device: DeviceSummaryDto) => boolean;
  unitBase: UnitBase;
  temperatureUnit: "c" | "f";
  compact: boolean;
  sort: DeviceSort;
  direction: SortDirection;
  onSort: (sort: DeviceSort) => void;
}

export function DeviceTable({
  devices,
  samples,
  isOnline,
  unitBase,
  temperatureUnit,
  compact,
  sort,
  direction,
  onSort,
}: DeviceTableProps) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [expanded, setExpanded] = useState<string | null>(null);
  const pad = compact ? "py-2" : "py-3";
  // Tailwind's `sm`. Below it the table cannot fit, so the list takes over.
  const wideEnoughForTable = useMediaQuery("(min-width: 640px)");

  const renderCell = (
    column: Column,
    device: DeviceSummaryDto,
    summary: MetricSummary | null,
    online: boolean
  ): ReactNode => {
    switch (column.sort) {
      case "status":
        return (
          <span className="flex items-center gap-2">
            <StatusDot online={online} />
            <span className={cn("truncate text-xs", online ? "text-foreground" : "text-muted-foreground")}>
              {online ? "Online" : "Offline"}
            </span>
          </span>
        );
      case "name":
        // The row is clickable for convenience, but the name is the real link:
        // it is what keyboard and screen-reader users reach, and it opens in a
        // new tab on middle click like any other link.
        return (
          <Link
            to={`/devices/${device.id}`}
            onClick={(event) => event.stopPropagation()}
            className="flex min-w-0 items-center gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: deviceColor(device.color) }}
              aria-hidden
            />
            <span className="min-w-0">
              <span className={cn("block truncate font-medium text-foreground", compact ? "text-sm" : "text-[0.95rem]")}>
                {device.name}
              </span>
              {!compact ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {[otherHostname(device), platformName(device.platform), device.os].filter(Boolean).join(" · ")}
                </span>
              ) : null}
            </span>
          </Link>
        );
      case "cpu":
        return <UsageCell value={summary?.cpuPct} compact={compact} />;
      case "memory":
        return <UsageCell value={summary?.memPct} compact={compact} />;
      case "disk":
        return <UsageCell value={summary?.diskMaxPct} compact={compact} />;
      case "net":
        return (
          <span className="text-xs text-muted-foreground tabular">
            {summary ? formatRate((summary.netRxBps ?? 0) + (summary.netTxBps ?? 0), unitBase) : "—"}
          </span>
        );
      case "temp":
        return (
          <span className="text-xs text-muted-foreground tabular">
            {summary?.cpuTempC != null ? formatTemperature(summary.cpuTempC, temperatureUnit) : "—"}
          </span>
        );
      case "uptime":
        return (
          <span className="text-xs text-muted-foreground tabular">
            {online
              ? formatDuration(summary?.uptimeSec ?? null)
              : device.lastSeenAt
                ? formatRelative(device.lastSeenAt)
                : "—"}
          </span>
        );
      case "alerts":
        return device.activeAlerts > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-2xs font-medium text-danger">
            <Bell className="h-3 w-3" />
            {device.activeAlerts}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      case "agent":
        return <span className="text-xs text-muted-foreground tabular">{device.agentVersion ?? "—"}</span>;
      default:
        return null;
    }
  };

  const renderExpansion = (device: DeviceSummaryDto, isExpanded: boolean) => (
    <AnimatePresence initial={false}>
      {isExpanded ? (
        <motion.div
          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <RowDetail device={device} unitBase={unitBase} />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  /*
   * The table needs 44rem before its columns stop colliding, which is wider
   * than any phone. Rather than leave people scrolling a cramped grid
   * sideways, small screens get the same rows as full-width cards.
   */
  if (!wideEnoughForTable) {
    return (
      <>
        <MobileSortBar sort={sort} direction={direction} onSort={onSort} />

        <ul className="space-y-2">
        {devices.map((device) => {
          const online = isOnline(device);
          const summary = (samples[device.id] ?? device.latest)?.summary ?? null;
          const isExpanded = expanded === device.id;

          return (
            <li key={device.id} className="overflow-hidden rounded-lg border border-border/70 bg-card">
              <div className="flex items-start gap-3 px-3 py-3">
                <Link
                  to={`/devices/${device.id}`}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: deviceColor(device.color) }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{device.name}</span>
                      {device.activeAlerts > 0 ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-danger/30 bg-danger/10 px-1.5 py-0.5 text-2xs font-medium text-danger">
                          <Bell className="h-3 w-3" />
                          {device.activeAlerts}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <StatusDot online={online} />
                      <span className="truncate">
                        {[
                          online ? "Online" : device.lastSeenAt ? formatRelative(device.lastSeenAt) : "Offline",
                          otherHostname(device),
                          device.os,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                  </span>
                </Link>

                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-label={isExpanded ? `Hide charts for ${device.name}` : `Show charts for ${device.name}`}
                  onClick={() => setExpanded(isExpanded ? null : device.id)}
                  className="tap-target -mr-1 flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isExpanded && "rotate-180")} />
                </button>
              </div>

              <dl className="space-y-1.5 px-3 pb-3">
                {(
                  [
                    ["CPU", summary?.cpuPct],
                    ["Memory", summary?.memPct],
                    ["Disk", summary?.diskMaxPct],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="flex items-center gap-3">
                    <dt className="w-14 shrink-0 text-xs text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 flex-1">
                      <UsageCell value={value} compact />
                    </dd>
                  </div>
                ))}
              </dl>

              {renderExpansion(device, isExpanded)}
            </li>
          );
        })}
        </ul>
      </>
    );
  }

  return (
    <div className="scroll-slim overflow-x-auto rounded-lg border border-border/70 bg-card">
      <table className="w-full min-w-[44rem] table-fixed border-collapse text-left">
        <thead className="border-b border-border/60 bg-surface-2/50">
          <tr>
            {COLUMNS.map((column) => (
              <SortHeader
                key={column.sort}
                column={column}
                active={sort === column.sort}
                direction={direction}
                onSort={onSort}
              />
            ))}
            <th scope="col" className="w-12 px-2">
              <span className="sr-only">Expand</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {devices.map((device) => {
            const online = isOnline(device);
            const summary = (samples[device.id] ?? device.latest)?.summary ?? null;
            const isExpanded = expanded === device.id;

            return (
              <Fragment key={device.id}>
                <tr
                  onClick={() => navigate(`/devices/${device.id}`)}
                  className={cn(
                    "cursor-pointer border-t border-border/50 transition-colors first:border-t-0",
                    "hover:bg-white/[0.03]",
                    isExpanded && "bg-white/[0.03]"
                  )}
                >
                  {COLUMNS.map((column) => (
                    <td key={column.sort} className={cn("px-3", pad, column.visibility)}>
                      {renderCell(column, device, summary, online)}
                    </td>
                  ))}
                  <td className={cn("px-2", pad)}>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={isExpanded ? `Hide charts for ${device.name}` : `Show charts for ${device.name}`}
                      title={isExpanded ? "Hide the recent activity" : "Show the recent activity"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(isExpanded ? null : device.id);
                      }}
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors",
                        "hover:bg-white/[0.08] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      )}
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform duration-200", isExpanded && "rotate-180")}
                      />
                    </button>
                  </td>
                </tr>

                <tr>
                  <td colSpan={COLUMNS.length + 1} className="p-0">
                    {renderExpansion(device, isExpanded)}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
