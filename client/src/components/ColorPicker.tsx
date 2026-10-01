import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Ban, Check, Copy, Pipette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { copyText } from "@/lib/clipboard";
import { DEVICE_COLORS, deviceColorHex, hexToHsv, hsvToHex, parseHexColor, type Hsv } from "@/lib/colors";
import { cn } from "@/lib/utils";

/**
 * Picks a device accent: a few quick presets, any colour from the picker
 * panel, or a typed hex value. `value` is `#rrggbb`, a legacy preset id, or an
 * empty string for no accent. Changes always come back as `#rrggbb` or "".
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { notify } = useToast();
  const hex = deviceColorHex(value);
  const [text, setText] = useState(hex ?? "");
  const [copied, setCopied] = useState(false);
  const [picking, setPicking] = useState(false);
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
        {/* The picker panel covers every colour, so its toggle sits with the presets. */}
        <button
          type="button"
          onClick={() => setPicking((current) => !current)}
          aria-expanded={picking}
          aria-label="Pick any colour"
          title="Pick any colour"
          className={cn(
            swatch,
            "flex items-center justify-center",
            custom || picking ? "ring-2 ring-foreground/70" : "ring-1 ring-border"
          )}
          style={{
            background: custom
              ? hex!
              : "conic-gradient(#f43f5e, #f59e0b, #84cc16, #10b981, #06b6d4, #3b82f6, #8b5cf6, #f43f5e)",
          }}
        >
          <Pipette className="h-3.5 w-3.5 text-white drop-shadow" aria-hidden />
        </button>
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

      {picking ? <HsvPanel hex={hex ?? DEVICE_COLORS[1].hex} onChange={onChange} /> : null}

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

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/**
 * A saturation and brightness square over a hue strip. It keeps its own hue
 * while dragging, because a grey or black has no hue to read back and the
 * strip would otherwise jump to red.
 */
function HsvPanel({ hex, onChange }: { hex: string; onChange: (value: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(hex));
  const sent = useRef(hex);

  // A preset, the hex field or Discard moved the colour from outside.
  useEffect(() => {
    if (hex !== sent.current) {
      sent.current = hex;
      setHsv(hexToHsv(hex));
    }
  }, [hex]);

  const update = (next: Hsv) => {
    setHsv(next);
    const value = hsvToHex(next);
    sent.current = value;
    onChange(value);
  };

  /** Follows the pointer from the press until release, even outside the element. */
  const drag = (read: (x: number, y: number) => void) => (event: PointerEvent<HTMLDivElement>) => {
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);
    const move = (x: number, y: number) => {
      const box = element.getBoundingClientRect();
      read(clamp((x - box.left) / box.width), clamp((y - box.top) / box.height));
    };
    move(event.clientX, event.clientY);
    const onMove = (moveEvent: globalThis.PointerEvent) => move(moveEvent.clientX, moveEvent.clientY);
    const stop = () => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerup", stop);
      element.removeEventListener("pointercancel", stop);
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerup", stop);
    element.addEventListener("pointercancel", stop);
  };

  const keys =
    (step: (dx: number, dy: number) => void) =>
    (event: KeyboardEvent<HTMLDivElement>) => {
      const size = event.shiftKey ? 0.1 : 0.01;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-size, 0],
        ArrowRight: [size, 0],
        ArrowUp: [0, -size],
        ArrowDown: [0, size],
      };
      const delta = moves[event.key];
      if (!delta) return;
      event.preventDefault();
      step(delta[0], delta[1]);
    };

  const knob = "pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]";

  return (
    <div className="space-y-3 rounded-lg border border-border/70 bg-surface-2 p-3">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onPointerDown={drag((x, y) => update({ ...hsv, s: x, v: 1 - y }))}
        onKeyDown={keys((dx, dy) => update({ ...hsv, s: clamp(hsv.s + dx), v: clamp(hsv.v - dy) }))}
        className="relative h-36 w-full cursor-crosshair touch-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
        }}
      >
        <span className={knob} style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hsvToHex(hsv) }} />
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onPointerDown={drag((x) => update({ ...hsv, h: x * 360 }))}
        onKeyDown={keys((dx) => update({ ...hsv, h: Math.min(360, Math.max(0, hsv.h + dx * 360)) }))}
        className="relative h-3 w-full cursor-pointer touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        style={{
          background:
            "linear-gradient(to right, #f00 0%, #ff0 16.66%, #0f0 33.33%, #0ff 50%, #00f 66.66%, #f0f 83.33%, #f00 100%)",
        }}
      >
        <span className={knob} style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
    </div>
  );
}
