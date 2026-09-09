import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  icon?: LucideIcon;
  accent?: string;
  className?: string;
  children?: React.ReactNode;
}

/** label · value · optional sublabel · optional trend, in that order. */
export function StatTile({ label, value, sublabel, icon: Icon, accent, className, children }: StatTileProps) {
  return (
    <div className={cn("rounded-lg border border-border/70 bg-card p-4", className)}>
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent ?? "hsl(var(--muted-foreground))" }} /> : null}
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-semibold leading-none text-foreground">{value}</p>
      {sublabel ? <p className="mt-1.5 text-2xs text-muted-foreground">{sublabel}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
