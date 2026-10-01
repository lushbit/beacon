import { useEffect, useState } from "react";
import { Check, ExternalLink, Globe, KeyRound, Link2, Lock, RefreshCw, Users } from "lucide-react";
import type { CanvasAccess, CanvasEmbed, CanvasPageDto } from "@beacon/shared";
import { CANVAS_SLUG_PATTERN } from "@beacon/shared";
import { CommandSteps } from "@/components/CommandSteps";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Row } from "./fields";

const ACCESS: { value: CanvasAccess; title: string; text: string; icon: typeof Globe }[] = [
  { value: "public", title: "Anyone with the address", text: "Good for status pages and public stats.", icon: Globe },
  { value: "unlisted", title: "Only with the secret link", text: "The address carries a key nobody can guess.", icon: Link2 },
  { value: "password", title: "Anyone with the password", text: "Visitors type a password you choose.", icon: KeyRound },
  { value: "users", title: "Only people signed in to Beacon", text: "Any account on this hub, admin or viewer.", icon: Users },
];

const EMBED: { value: CanvasEmbed; label: string }[] = [
  { value: "none", label: "Nowhere" },
  { value: "any", label: "Any site" },
  { value: "list", label: "Only these sites" },
];

/** The address a visitor opens, with the key an unlisted page needs. */
export function pageAddress(page: CanvasPageDto): string {
  const base = `${window.location.origin}/p/${page.slug}`;
  return page.access === "unlisted" ? `${base}?key=${page.shareKey}` : base;
}

export function ShareDialog({
  page,
  open,
  onOpenChange,
  onPage,
}: {
  page: CanvasPageDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPage: (page: CanvasPageDto) => void;
}) {
  const { attempt } = useToast();
  const [slug, setSlug] = useState(page.slug);
  const [password, setPassword] = useState("");
  const [origins, setOrigins] = useState(page.embedOrigins.join("\n"));
  const [transparent, setTransparent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSlug(page.slug);
    setOrigins(page.embedOrigins.join("\n"));
    setPassword("");
    // Only when the dialog opens. Saving one setting must not undo typing in another.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async (body: Parameters<typeof api.updateCanvasSettings>[1], success?: string) => {
    setBusy(true);
    const result = await attempt(() => api.updateCanvasSettings(page.id, body), success);
    setBusy(false);
    if (result) onPage(result);
    return result;
  };

  const slugValid = CANVAS_SLUG_PATTERN.test(slug);
  const address = pageAddress(page);
  const embedSrc = `${address}${address.includes("?") ? "&" : "?"}kiosk${transparent ? "&theme=transparent" : ""}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader title="Share this page" description="Changes here apply straight away, to the published page." />
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-surface/60 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{page.enabled ? "The page is online" : "The page is offline"}</p>
              <p className="text-2xs text-muted-foreground">
                {!page.published
                  ? "Nothing is visible until you publish for the first time."
                  : page.enabled
                    ? "Turn it off to take it down without deleting it."
                    : "Visitors see that the page is not available."}
              </p>
            </div>
            <Switch checked={page.enabled} disabled={busy} onCheckedChange={(enabled) => void save({ enabled })} />
          </div>

          <Row label="Address" hint="Lowercase letters, digits and dashes.">
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center rounded-md border border-input bg-surface-2 pl-3 focus-within:border-primary/60">
                <span className="shrink-0 truncate text-sm text-muted-foreground">/p/</span>
                <input
                  className="h-9 min-w-0 flex-1 bg-transparent pr-3 text-sm text-foreground focus:outline-none"
                  value={slug}
                  maxLength={48}
                  onChange={(event) => setSlug(event.target.value.toLowerCase())}
                  aria-label="Page address"
                />
              </div>
              <Button variant="secondary" disabled={busy || !slugValid || slug === page.slug} onClick={() => void save({ slug }, "The address was changed.")}>
                Save
              </Button>
            </div>
            {slug !== page.slug && !slugValid ? <p className="text-2xs text-danger">Use 2 to 48 lowercase letters, digits and dashes.</p> : null}
          </Row>

          <Row label="Who can open it">
            <div className="grid gap-2">
              {ACCESS.map((option) => {
                const Icon = option.icon;
                const active = page.access === option.value;
                const needsPassword = option.value === "password" && !page.hasPassword;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (active) return;
                      if (needsPassword) {
                        document.getElementById("canvas-password")?.focus();
                        return;
                      }
                      void save({ access: option.value });
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                      active ? "border-foreground/50 bg-surface-2" : "border-border hover:border-foreground/25"
                    )}
                  >
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">{option.title}</span>
                      <span className="block text-2xs text-muted-foreground">
                        {needsPassword ? "Set a password below first." : option.text}
                      </span>
                    </span>
                    {active ? <Check className="h-4 w-4 shrink-0 text-foreground" /> : null}
                  </button>
                );
              })}
            </div>
          </Row>

          {page.access === "unlisted" ? (
            <Row label="Secret link" hint="Anyone with this link can open the page. Making a new one stops the old one working.">
              <CommandSteps steps={[{ command: address }]} />
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ regenerateKey: true }, "The old link no longer works.")}>
                <RefreshCw className="h-3.5 w-3.5" /> Make a new link
              </Button>
            </Row>
          ) : null}

          <Row label="Password" hint={page.hasPassword ? "A password is set. Type a new one to change it." : "At least 6 characters."}>
            <div className="flex items-center gap-2">
              <Input
                id="canvas-password"
                type="password"
                autoComplete="new-password"
                value={password}
                placeholder={page.hasPassword ? "••••••••" : "Choose a password"}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy || password.length < 6}
                onClick={async () => {
                  const result = await save(
                    page.access === "password" ? { password } : { password, access: "password" },
                    "The page now asks for this password."
                  );
                  if (result) setPassword("");
                }}
              >
                <Lock className="h-3.5 w-3.5" /> Set
              </Button>
            </div>
            {page.hasPassword && page.access !== "password" ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void save({ password: null }, "The password was removed.")}>
                Remove the password
              </Button>
            ) : null}
          </Row>

          <Row label="Show it on other sites" hint="Lets another website show this page, or one block of it, in a frame.">
            <div className="flex w-full rounded-md border border-border bg-surface-2 p-0.5">
              {EMBED.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={page.embed === option.value}
                  onClick={() => void save({ embed: option.value })}
                  className={cn(
                    "h-7 flex-1 rounded px-2 text-xs font-medium transition-colors",
                    page.embed === option.value ? "bg-surface-3 text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {page.embed === "list" ? (
              <div className="space-y-2 pt-1">
                <Textarea
                  rows={3}
                  value={origins}
                  placeholder={"https://example.com\nhttps://*.example.org"}
                  onChange={(event) => setOrigins(event.target.value)}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void save({ embedOrigins: origins.split(/[\s,]+/).filter(Boolean) }, "The list of sites was saved.")}
                >
                  Save sites
                </Button>
              </div>
            ) : null}
          </Row>

          {page.embed !== "none" ? (
            <Row label="Embed code">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" className="accent-white" checked={transparent} onChange={(event) => setTransparent(event.target.checked)} />
                See-through background, so the page blends into the site
              </label>
              <CommandSteps steps={[{ command: `<iframe src="${embedSrc}" style="width:100%;height:900px;border:0" loading="lazy"></iframe>` }]} />
              {page.access === "users" ? (
                <p className="text-2xs text-warning">Signed-in pages only show inside a frame on this hub's own address, because browsers keep the sign-in to it.</p>
              ) : null}
            </Row>
          ) : null}

          {page.published && page.enabled ? (
            <Button asChild variant="outline" className="w-full">
              <a href={address} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4" /> Open the page
              </a>
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
