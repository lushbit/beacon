import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp, ArrowUpCircle, ArrowUpDown, Bell, ChevronDown } from "lucide-react";
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
import { RelativeTime } from "@/components/RelativeTime";
import { formatDuration, formatPercent, formatRate, formatTemperature, platformName } from "@/lib/format";
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
 * The desktop columns a phone card has no meter for, shown as a row of small
 * figures under the meters. Alerts already sit beside the name.
 */
const MOBILE_DETAILS: DeviceSort[] = ["net", "temp", "uptime", "agent"];

/** One sort control, shared by the table headers and the phone's sort row so both look the same. */
function SortButton({
  option,
  active,
  direction,
  onSort,
  className,
}: {
  option: DeviceSort;
  active: boolean;
  direction: SortDirection;
  onSort: (sort: DeviceSort) => void;
  className?: string;
}) {
  const label = DEVICE_SORT_LABELS[option];
  const labels = DEVICE_SORT_DIRECTION_LABELS[option];
  const Icon = !active ? ArrowUpDown : direction === "asc" ? ArrowUp : ArrowDown;
  const next = !active ? labels.asc : direction === "asc" ? labels.desc : "the default order";

  return (
    <button
      type="button"
      onClick={() => onSort(option)}
      aria-pressed={active}
      title={`${active ? labels[direction] : `Not sorted by ${label.toLowerCase()}`}. Click for ${next.toLowerCase()}.`}
      className={cn(
        "group flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        active ? "text-foreground" : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
        className
      )}
    >
      <span className="truncate">{label}</span>
      <Icon
        className={cn(
          "h-3 w-3 shrink-0 transition-opacity",
          active ? "opacity-100" : "opacity-50 group-hover:opacity-100"
        )}
      />
    </button>
  );
}

/**
 * The phone layout has no table headers to click, so its list carries every
 * column's sort control in a header row of its own. The row stays on one line
 * and scrolls sideways, with a fade on the right to show there is more.
 */
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
    <div className="relative border-b border-border/60 bg-surface-2/50">
      <div className="scroll-slim flex items-center gap-x-1 overflow-x-auto py-1 pl-1.5 pr-8">
        {COLUMNS.map((column) => (
          <SortButton
            key={column.sort}
            option={column.sort}
            active={sort === column.sort}
            direction={direction}
            onSort={onSort}
            className="shrink-0"
          />
        ))}
      </div>
      <span
        className="pointer-events-none absolute inset-y-0 right-0 w-8"
        style={{
          background:
            "linear-gradient(to left, color-mix(in srgb, hsl(var(--surface-2)) 50%, hsl(var(--card))), transparent)",
        }}
        aria-hidden
      />
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
  return (
    <th scope="col" className={cn("px-3 py-1.5 text-left font-normal", column.width, column.visibility)}>
      <SortButton option={column.sort} active={active} direction={direction} onSort={onSort} className="-mx-1.5" />
    </th>
  );
}

/** Whether the device is online, and whether its agent has an update waiting, in front of its name. */
function DeviceMarkers({
  device,
  online,
  className,
}: {
  device: DeviceSummaryDto;
  online: boolean;
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5", className)}>
      <span title={online ? "Online" : "Offline"} className="flex">
        <StatusDot online={online} />
        <span className="sr-only">{online ? "Online" : "Offline"}</span>
      </span>
      {device.compatibility === "outdated" ? (
        <span title="Agent update available" className="flex">
          <ArrowUpCircle className="h-3.5 w-3.5 text-info" aria-hidden />
          <span className="sr-only">Agent update available</span>
        </span>
      ) : null}
    </span>
  );
}

/** The device's colour, as a stripe down the left edge of its row. */
function ColorBar({ color }: { color: string }) {
  return <span className="absolute inset-y-0 left-0 w-1" style={{ background: deviceColor(color) }} aria-hidden />;
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
            <DeviceMarkers device={device} online={online} />
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
                ? <RelativeTime value={device.lastSeenAt} />
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
   * The table needs 36rem before its columns stop colliding, which is wider
   * than any phone. Rather than leave people scrolling a cramped grid
   * sideways, small screens stack the same rows in one list under a header
   * of sort controls.
   */
  if (!wideEnoughForTable) {
    return (
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
        <MobileSortBar sort={sort} direction={direction} onSort={onSort} />

        <ul className="divide-y divide-border/50">
        {devices.map((device) => {
          const online = isOnline(device);
          const summary = (samples[device.id] ?? device.latest)?.summary ?? null;
          const isExpanded = expanded === device.id;
          const details = [otherHostname(device), device.os].filter(Boolean).join(" · ");

          return (
            <li key={device.id} className="relative">
              <ColorBar color={device.color} />
              <div className="flex items-start gap-3 px-3 py-3">
                <Link
                  to={`/devices/${device.id}`}
                  className="flex min-w-0 flex-1 items-start gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <DeviceMarkers device={device} online={online} className="h-6" />
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
                    {details ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{details}</span>
                    ) : null}
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

              <dl className="space-y-1.5 px-3 pb-2.5">
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

              <dl className="grid grid-cols-4 gap-x-3 px-3 pb-3">
                {MOBILE_DETAILS.map((option) => (
                  <div key={option} className="min-w-0">
                    <dt className="text-2xs text-muted-foreground">{DEVICE_SORT_LABELS[option]}</dt>
                    <dd className="truncate">{renderCell({ sort: option }, device, summary, online)}</dd>
                  </div>
                ))}
              </dl>

              {renderExpansion(device, isExpanded)}
            </li>
          );
        })}
        </ul>
      </div>
    );
  }

  return (
    <div className="scroll-slim overflow-x-auto rounded-lg border border-border/70 bg-card">
      <table className="w-full min-w-[36rem] table-fixed border-collapse text-left">
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
                  {COLUMNS.map((column, index) => (
                    <td key={column.sort} className={cn("px-3", pad, column.visibility, index === 0 && "relative")}>
                      {index === 0 ? <ColorBar color={device.color} /> : null}
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
