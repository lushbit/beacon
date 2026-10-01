import { useEffect, useRef, useState } from "react";
import { Ban, Check, Copy, Pipette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { copyText } from "@/lib/clipboard";
import { DEVICE_COLORS, deviceColorHex, parseHexColor } from "@/lib/colors";
import { cn } from "@/lib/utils";

/**
 * Picks a device accent: a few quick presets, any colour from the system
 * picker, or a typed hex value. `value` is `#rrggbb`, a legacy preset id, or an
 * empty string for no accent. Changes always come back as `#rrggbb` or "".
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { notify } = useToast();
  const hex = deviceColorHex(value);
  const [text, setText] = useState(hex ?? "");
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  // Follow the value when it changes from outside, such as a preset or Discard.
  useEffect(() => setText(hex ?? ""), [hex]);

  const custom = hex !== null && !DEVICE_COLORS.some((preset) => preset.hex === hex);

  const copy = async () => {
    if (!hex) return;
    const result = await copyText(hex, field.current);
    if (result === "copied") {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } else {
      field.current?.select();
      notify("Copying is blocked here. The value is selected, so copy it by hand.", "error");
    }
  };

  const swatch = "relative h-7 w-7 shrink-0 rounded-full ring-offset-2 ring-offset-card transition-shadow";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {DEVICE_COLORS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => onChange(preset.hex)}
            aria-label={preset.label}
            aria-pressed={hex === preset.hex}
            className={cn(swatch, hex === preset.hex ? "ring-2 ring-foreground/70" : "ring-1 ring-border")}
            style={{ background: preset.hex }}
          />
        ))}
        {/* The system picker covers every colour, so it sits with the presets. */}
        <label
          title="Pick any colour"
          className={cn(
            swatch,
            "flex cursor-pointer items-center justify-center",
            custom ? "ring-2 ring-foreground/70" : "ring-1 ring-border"
          )}
          style={{
            background: custom
              ? hex!
              : "conic-gradient(#f43f5e, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #f43f5e)",
          }}
        >
          <Pipette className="h-3.5 w-3.5 text-white drop-shadow" aria-hidden />
          <span className="sr-only">Pick any colour</span>
          <input
            type="color"
            value={hex ?? DEVICE_COLORS[0].hex}
            onChange={(event) => onChange(event.target.value.toLowerCase())}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="No colour"
          title="No colour"
          aria-pressed={hex === null}
          className={cn(
            swatch,
            "flex items-center justify-center bg-surface-2 text-muted-foreground",
            hex === null ? "ring-2 ring-foreground/70" : "ring-1 ring-border"
          )}
        >
          <Ban className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-32">
          <span
            className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-sm ring-1 ring-border"
            style={{ background: hex ?? "transparent" }}
            aria-hidden
          />
          <Input
            ref={field}
            value={text}
            placeholder="None"
            spellCheck={false}
            maxLength={7}
            aria-label="Hex colour"
            onChange={(event) => {
              setText(event.target.value);
              const parsed = parseHexColor(event.target.value);
              if (parsed && event.target.value.replace("#", "").length === 6) onChange(parsed);
            }}
            onBlur={() => {
              const parsed = parseHexColor(text);
              if (parsed) onChange(parsed);
              else setText(hex ?? "");
            }}
            className="pl-8 font-mono text-xs uppercase"
          />
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} disabled={!hex} aria-label="Copy hex value">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
        {hex ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange("")}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  );
}
