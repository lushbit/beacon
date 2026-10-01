import {
  Activity,
  BellRing,
  Box,
  Clock,
  Cpu,
  Gauge,
  HardDrive,
  Heading,
  History,
  Info,
  LayoutGrid,
  LineChart,
  Minus,
  MoveVertical,
  Radio,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { CanvasBlockType } from "@beacon/shared";
import { CANVAS_BLOCK_INFO, CANVAS_BLOCK_TYPES } from "@beacon/shared";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";

export const BLOCK_ICONS: Record<CanvasBlockType, LucideIcon> = {
  heading: Heading,
  text: Type,
  divider: Minus,
  spacer: MoveVertical,
  chart: LineChart,
  value: Activity,
  gauge: Gauge,
  status: Radio,
  info: Info,
  volumes: HardDrive,
  containers: Box,
  cores: Cpu,
  devices: LayoutGrid,
  uptime: History,
  alerts: BellRing,
  clock: Clock,
};

const GROUPS = ["Metrics", "Device", "Fleet", "Layout"] as const;

/** The data type a library item carries while it is dragged onto the grid. */
export const DRAG_TYPE = "application/x-beacon-block";

/**
 * Every kind of block, grouped. On a wide screen it sits beside the grid and
 * items are dragged onto it or clicked to add at the bottom.
 */
export function BlockLibrary({
  onAdd,
  onDragType,
}: {
  onAdd: (type: CanvasBlockType) => void;
  onDragType: (type: CanvasBlockType | null) => void;
}) {
  return (
    <div className="space-y-4 p-3">
      <p className="px-1 text-2xs text-muted-foreground">Drag onto the page or click to add at the bottom.</p>
      {GROUPS.map((group) => (
        <div key={group} className="space-y-1">
          <p className="px-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
          {CANVAS_BLOCK_TYPES.filter((type) => CANVAS_BLOCK_INFO[type].group === group).map((type) => {
            const Icon = BLOCK_ICONS[type];
            const info = CANVAS_BLOCK_INFO[type];
            return (
              <button
                key={type}
                type="button"
                draggable
                // react-grid-layout reads the drop position itself. The data is
                // only there because Firefox will not start a drag without some.
                unselectable="on"
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", "");
                  event.dataTransfer.setData(DRAG_TYPE, type);
                  event.dataTransfer.effectAllowed = "copy";
                  onDragType(type);
                }}
                onDragEnd={() => onDragType(null)}
                onClick={() => onAdd(type)}
                title={info.description}
                className="group flex w-full cursor-grab items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-surface-2 active:cursor-grabbing"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted-foreground transition-colors group-hover:bg-surface-3 group-hover:text-foreground">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 truncate text-sm text-foreground">{info.label}</span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** The same choice as a popup, for the + on an empty spot and for small screens. */
export function BlockPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (type: CanvasBlockType) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title="Add a block" description="Choose what to show here." />
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <div key={group}>
              <p className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CANVAS_BLOCK_TYPES.filter((type) => CANVAS_BLOCK_INFO[type].group === group).map((type) => {
                  const Icon = BLOCK_ICONS[type];
                  const info = CANVAS_BLOCK_INFO[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onPick(type)}
                      className="flex items-start gap-3 rounded-md border border-border bg-surface/60 p-3 text-left transition-colors hover:border-foreground/25 hover:bg-surface-2"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-2 text-foreground">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-foreground">{info.label}</span>
                        <span className="block text-2xs text-muted-foreground">{info.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
