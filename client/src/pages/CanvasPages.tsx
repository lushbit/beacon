import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, Download, ExternalLink, FileUp, Globe, KeyRound, LayoutDashboard, Link2, Pencil, Plus, Trash2, Users } from "lucide-react";
import type { CanvasAccess, CanvasContent, CanvasDeviceMeta, CanvasPageSummaryDto } from "@beacon/shared";
import { CANVAS_SLUG_PATTERN, slugify } from "@beacon/shared";
import { PageHeader } from "@/components/DashboardLayout";
import { RelativeTime } from "@/components/RelativeTime";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CANVAS_TEMPLATES, templateContent, type CanvasTemplateId } from "@/canvas/layout";
import { selectClass } from "@/canvas/editor/fields";

const ACCESS_LABEL: Record<CanvasAccess, { label: string; icon: typeof Globe }> = {
  public: { label: "Public", icon: Globe },
  unlisted: { label: "Secret link", icon: Link2 },
  password: { label: "Password", icon: KeyRound },
  users: { label: "Signed in", icon: Users },
};

/** What an export file holds, so an import can tell it apart from any other JSON. */
interface CanvasExport {
  beaconCanvas: 1;
  content: CanvasContent;
}

function NewPageDialog({
  open,
  onOpenChange,
  imported,
  devices,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imported: CanvasContent | null;
  devices: CanvasDeviceMeta[];
}) {
  const navigate = useNavigate();
  const { attempt } = useToast();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [template, setTemplate] = useState<CanvasTemplateId>("blank");
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start = imported?.title ?? "";
    setTitle(start);
    setSlug(slugify(start));
    setSlugEdited(false);
    setTemplate("blank");
    setDeviceId(devices.find((device) => device.status === "online")?.id ?? devices[0]?.id ?? "");
  }, [open, imported, devices]);

  const needsDevice = CANVAS_TEMPLATES.find((entry) => entry.id === template)?.needsDevice ?? false;
  const valid = title.trim().length > 0 && CANVAS_SLUG_PATTERN.test(slug) && (!needsDevice || deviceId !== "");

  const create = async () => {
    setBusy(true);
    const device = devices.find((entry) => entry.id === deviceId) ?? null;
    const content = imported ?? templateContent(template, title.trim(), device);
    const page = await attempt(() => api.createCanvasPage({ title: title.trim(), slug, content }));
    setBusy(false);
    if (page) navigate(`/canvas/${page.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          title={imported ? "Import a page" : "New page"}
          description={imported ? "The imported page is saved as a draft. Nothing is public until you publish it." : "Pick a starting point. Every block can be changed afterwards."}
        />
        <div className="space-y-4">
          <Field label="Title" htmlFor="canvas-title">
            <Input
              id="canvas-title"
              autoFocus
              value={title}
              maxLength={120}
              placeholder="Homelab status"
              onChange={(event) => {
                setTitle(event.target.value);
                if (!slugEdited) setSlug(slugify(event.target.value));
              }}
            />
          </Field>
          <Field label="Address" htmlFor="canvas-slug" hint={`The page will live at ${window.location.origin}/p/${slug || "…"}`}>
            <Input
              id="canvas-slug"
              value={slug}
              maxLength={48}
              placeholder="homelab"
              onChange={(event) => {
                setSlug(event.target.value.toLowerCase());
                setSlugEdited(true);
              }}
            />
          </Field>
          {slug && !CANVAS_SLUG_PATTERN.test(slug) ? <p className="-mt-2 text-2xs text-danger">Use 2 to 48 lowercase letters, digits and dashes.</p> : null}

          {imported ? null : (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Start from</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {CANVAS_TEMPLATES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setTemplate(entry.id)}
                    aria-pressed={template === entry.id}
                    className={cn(
                      "rounded-md border p-3 text-left transition-colors",
                      template === entry.id ? "border-foreground/50 bg-surface-2" : "border-border hover:border-foreground/25"
                    )}
                  >
                    <span className="block text-sm font-medium text-foreground">{entry.label}</span>
                    <span className="block text-2xs text-muted-foreground">{entry.description}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsDevice && !imported ? (
            <Field label="Device" htmlFor="canvas-device">
              <select id="canvas-device" className={selectClass} value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
                {devices.length === 0 ? <option value="">No devices yet</option> : null}
                {devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => void create()}>
            {busy ? "Creating…" : imported ? "Import" : "Create page"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CanvasPagesPage() {
  const { notify, attempt } = useToast();
  const navigate = useNavigate();
  const [pages, setPages] = useState<CanvasPageSummaryDto[] | null>(null);
  const [devices, setDevices] = useState<CanvasDeviceMeta[]>([]);
  const [creating, setCreating] = useState(false);
  const [imported, setImported] = useState<CanvasContent | null>(null);
  const [deleting, setDeleting] = useState<CanvasPageSummaryDto | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      setPages(await api.canvasPages());
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not load the pages.", "error");
      setPages([]);
    }
  };

  useEffect(() => {
    void load();
    api.canvasDevices().then(setDevices).catch(() => setDevices([]));
    // Loaded once when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportPage = async (summary: CanvasPageSummaryDto) => {
    const page = await attempt(() => api.canvasPage(summary.id));
    if (!page) return;
    const body: CanvasExport = { beaconCanvas: 1, content: page.draft };
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${summary.slug}.canvas.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<CanvasExport>;
      if (parsed.beaconCanvas !== 1 || !parsed.content || !Array.isArray(parsed.content.blocks)) throw new Error("bad file");
      setImported(parsed.content);
      setCreating(true);
    } catch {
      notify("That file is not a Canvas page export.", "error");
    }
  };

  const duplicate = async (summary: CanvasPageSummaryDto) => {
    const copy = await attempt(() => api.duplicateCanvas(summary.id), "The page was copied.");
    if (copy) navigate(`/canvas/${copy.id}`);
  };

  const remove = async () => {
    if (!deleting) return;
    const done = await attempt(() => api.deleteCanvas(deleting.id), "The page was deleted.");
    if (done) setPages((current) => current?.filter((page) => page.id !== deleting.id) ?? null);
    setDeleting(null);
  };

  return (
    <div>
      <PageHeader
        title="Canvas"
        description="Build pages from your devices' stats and share them with anyone, or show them on another site."
        actions={
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importFile(file);
                event.target.value = "";
              }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <FileUp className="h-4 w-4" /> Import
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setImported(null);
                setCreating(true);
              }}
            >
              <Plus className="h-4 w-4" /> New page
            </Button>
          </>
        }
      />

      <div className="p-4 sm:p-6">
        {pages === null ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : pages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border">
            <EmptyState
              icon={LayoutDashboard}
              title="No pages yet"
              description="A page is a grid of blocks: charts, numbers, gauges, status and more, from any of your devices. Publish it at its own address, protect it with a password, or embed it in another site."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" /> Create your first page
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {pages.map((page) => {
              const access = ACCESS_LABEL[page.access];
              const AccessIcon = access.icon;
              const live = page.published && page.enabled;
              return (
                <li key={page.id} className="flex flex-col rounded-lg border border-border/70 bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link to={`/canvas/${page.id}`} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground hover:underline">{page.title}</p>
                      <p className="truncate text-xs text-muted-foreground">/p/{page.slug}</p>
                    </Link>
                    <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                      {!page.published ? (
                        <Badge tone="neutral">Not published</Badge>
                      ) : page.enabled ? (
                        <Badge tone="success">Online</Badge>
                      ) : (
                        <Badge tone="warning">Offline</Badge>
                      )}
                      {page.published && page.dirty ? <Badge tone="info">Unpublished changes</Badge> : null}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <AccessIcon className="h-3 w-3" /> {access.label}
                    </span>
                    <span>
                      {page.blocks} {page.blocks === 1 ? "block" : "blocks"}
                    </span>
                    <span>
                      Edited <RelativeTime value={page.updatedAt} />
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-3">
                    <Button asChild variant="secondary" size="sm">
                      <Link to={`/canvas/${page.id}`}>
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Link>
                    </Button>
                    {live && page.access !== "unlisted" ? (
                      <Button asChild variant="ghost" size="sm">
                        <a href={`/p/${page.slug}`} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" /> View
                        </a>
                      </Button>
                    ) : null}
                    <span className="flex-1" />
                    <Button variant="ghost" size="icon" title="Duplicate" aria-label="Duplicate page" onClick={() => void duplicate(page)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" title="Export as a file" aria-label="Export page" onClick={() => void exportPage(page)}>
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="hover:text-danger" title="Delete" aria-label="Delete page" onClick={() => setDeleting(page)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <NewPageDialog open={creating} onOpenChange={setCreating} imported={imported} devices={devices} />

      <Dialog open={deleting !== null} onOpenChange={(open) => (open ? null : setDeleting(null))}>
        <DialogContent>
          <DialogHeader
            title="Delete this page?"
            description={`"${deleting?.title ?? ""}" and its address stop working for everyone, including any site that shows it. This cannot be undone.`}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete page
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
