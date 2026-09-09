import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-2 text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Live/offline dot with a soft halo while online. */
export function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span className={cn("relative flex h-2 w-2", className)}>
      {online ? (
        <span className="absolute inline-flex h-full w-full animate-pulse-ring rounded-full bg-success/70" />
      ) : null}
      <span
        className={cn("relative inline-flex h-2 w-2 rounded-full", online ? "bg-success" : "bg-muted-foreground/50")}
      />
    </span>
  );
}
