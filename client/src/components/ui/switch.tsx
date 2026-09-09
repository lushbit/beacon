import { forwardRef } from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

/**
 * The track carries the state, not the thumb: white track with a black thumb
 * when on, dark bordered track with a grey thumb when off. A white thumb on
 * both states reads as "always on" at a glance.
 */
export const Switch = forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-[1.35rem] w-10 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "data-[state=checked]:border-primary-strong data-[state=checked]:bg-primary-strong",
      "data-[state=unchecked]:border-border data-[state=unchecked]:bg-surface-2 hover:data-[state=unchecked]:bg-surface-3",
      className
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-[0.95rem] w-[0.95rem] rounded-full shadow-sm transition-transform",
        "data-[state=checked]:translate-x-[1.28rem] data-[state=checked]:bg-primary-foreground",
        "data-[state=unchecked]:translate-x-[0.15rem] data-[state=unchecked]:bg-muted-foreground"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";
