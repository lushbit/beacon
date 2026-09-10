import { ShieldAlert } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** Switches the commands in a setup dialog over to skipping certificate checks. */
export function SelfSignedToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-md border p-3 transition-colors",
        checked ? "border-warning/50 bg-warning/10" : "border-warning/25 bg-warning/[0.04]"
      )}
    >
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
          <ShieldAlert className="h-4 w-4 shrink-0" />
          This hub uses a self-signed certificate
        </p>
        <p className="mt-1 text-2xs text-warning/80">
          Adds the flags needed to skip certificate verification. Prefer a real certificate where you can. This turns
          off the check that proves the device is talking to your hub.
        </p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label="Hub uses a self-signed certificate" />
    </div>
  );
}
