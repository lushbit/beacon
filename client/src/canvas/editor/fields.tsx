import type { ReactNode } from "react";
import type { CanvasDeviceMeta, CanvasDeviceSelector, CanvasThresholds, CanvasUnit } from "@beacon/shared";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A labelled row in the settings panel. */
export function Row({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      {children}
      {hint ? <p className="text-2xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const selectClass =
  "h-9 w-full rounded-md border border-input bg-surface-2 px-2.5 text-sm text-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** A plain select. Native, so long grouped lists stay quick and work on phones. */
export function NativeSelect({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <select className={selectClass} value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
      {children}
    </select>
  );
}

export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {hint ? <span className="block text-2xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

/** A row of buttons where one is on, for short choices like alignment. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="flex w-full rounded-md border border-border bg-surface-2 p-0.5" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-7 min-w-0 flex-1 items-center justify-center gap-1 rounded px-1.5 text-xs font-medium transition-colors",
            option.value === value ? "bg-surface-3 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
  label,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  label: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      className={selectClass}
      value={value ?? ""}
      placeholder={placeholder}
      min={min}
      max={max}
      onChange={(event) => {
        const text = event.target.value.trim();
        if (text === "") return onChange(null);
        const parsed = Number(text);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
    />
  );
}

export function DevicePicker({
  devices,
  value,
  onChange,
}: {
  devices: CanvasDeviceMeta[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <NativeSelect value={value} onChange={onChange} label="Device">
      <option value="">Choose a device…</option>
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
          {device.status === "online" ? "" : " (offline)"}
        </option>
      ))}
    </NativeSelect>
  );
}

/** All devices, those with a tag, or a hand-picked few. */
export function SelectorField({
  devices,
  value,
  onChange,
}: {
  devices: CanvasDeviceMeta[];
  value: CanvasDeviceSelector;
  onChange: (value: CanvasDeviceSelector) => void;
}) {
  const tags = [...new Set(devices.flatMap((device) => device.tags))].sort((a, b) => a.localeCompare(b));
  return (
    <div className="space-y-2">
      <Segmented
        label="Which devices"
        value={value.mode}
        onChange={(mode) => onChange({ ...value, mode })}
        options={[
          { value: "all", label: "All" },
          { value: "tag", label: "With tag" },
          { value: "pick", label: "Chosen" },
        ]}
      />
      {value.mode === "all" ? (
        <p className="text-2xs text-muted-foreground">Every device, including ones added later.</p>
      ) : value.mode === "tag" ? (
        tags.length === 0 ? (
          <p className="text-2xs text-muted-foreground">No device has a tag yet. Add tags in the device settings.</p>
        ) : (
          <NativeSelect value={value.tag} onChange={(tag) => onChange({ ...value, tag })} label="Tag">
            <option value="">Choose a tag…</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </NativeSelect>
        )
      ) : (
        <div className="scroll-slim max-h-52 space-y-1 overflow-y-auto rounded-md border border-border bg-surface-2/50 p-2">
          {devices.length === 0 ? <p className="text-2xs text-muted-foreground">No devices yet.</p> : null}
          {devices.map((device) => {
            const checked = value.ids.includes(device.id);
            return (
              <label key={device.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-white/[0.03]">
                <input
                  type="checkbox"
                  className="accent-white"
                  checked={checked}
                  onChange={() =>
                    onChange({ ...value, ids: checked ? value.ids.filter((id) => id !== device.id) : [...value.ids, device.id] })
                  }
                />
                <span className="truncate text-foreground">{device.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ThresholdsField({
  value,
  onChange,
  unit,
}: {
  value: CanvasThresholds;
  onChange: (value: CanvasThresholds) => void;
  unit: CanvasUnit | undefined;
}) {
  const suffix = unit === "percent" ? "%" : unit === "temperature" ? "°C" : "";
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-warning" /> Warning at{suffix ? ` (${suffix})` : ""}
          </span>
          <NumberInput label="Warning at" value={value.warn} onChange={(warn) => onChange({ ...value, warn })} placeholder="Off" />
        </label>
        <label className="space-y-1">
          <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-danger" /> Critical at{suffix ? ` (${suffix})` : ""}
          </span>
          <NumberInput label="Critical at" value={value.crit} onChange={(crit) => onChange({ ...value, crit })} placeholder="Off" />
        </label>
      </div>
      <Toggle label="Invert" hint="Low values turn yellow and red." checked={value.below} onChange={(below) => onChange({ ...value, below })} />
      {unit === "bytes" || unit === "rate" ? <p className="text-2xs text-muted-foreground">Limits are in bytes. 1000000 is about 1 MB.</p> : null}
    </div>
  );
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3 border-b border-border/60 px-4 py-4 last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-foreground">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
