import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/context/ToastContext";
import { copyText } from "@/lib/clipboard";

export interface Step {
  /** Shown above the command when a platform needs more than one. */
  title?: string;
  command: string;
  note?: string;
}

function CommandBlock({
  step,
  index,
  total,
  onCopy,
}: {
  step: Step;
  index: number;
  total: number;
  onCopy?: () => void;
}) {
  const { notify } = useToast();
  const [copied, setCopied] = useState(false);
  const block = useRef<HTMLPreElement>(null);

  const copy = async () => {
    const result = await copyText(step.command, block.current);
    // A blocked copy still leaves the command selected to copy by hand, so
    // either way it is about to be run.
    onCopy?.();
    if (result === "copied") {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      return;
    }
    notify("This browser blocked the copy. The command is selected, so copy it from there.", "info");
  };

  return (
    <div className="space-y-2">
      {total > 1 ? (
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Step {index + 1} of {total}
          {step.title ? ` — ${step.title}` : ""}
        </p>
      ) : null}
      <pre
        ref={block}
        className="scroll-slim max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface-2 p-3 text-2xs leading-relaxed text-foreground"
      >
        {step.command}
      </pre>
      <div className="flex items-center justify-between gap-3">
        {step.note ? <p className="text-2xs text-muted-foreground">{step.note}</p> : <span />}
        <Button variant="secondary" size="sm" onClick={() => void copy()} className="shrink-0">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

/** Each command gets its own block and its own copy button, so nothing is pasted half. */
export function CommandSteps({ steps, onCopy }: { steps: Step[]; onCopy?: () => void }) {
  return (
    <div className="space-y-4">
      {steps.map((step, index) => (
        <CommandBlock key={step.command} step={step} index={index} total={steps.length} onCopy={onCopy} />
      ))}
    </div>
  );
}
