import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  ExternalLink,
  LayoutDashboard,
  Pencil,
  Plus,
  Redo2,
  Share2,
  SlidersHorizontal,
  Undo2,
  Upload,
} from "lucide-react";
import type { CanvasBlock, CanvasBlockType, CanvasContent, CanvasDeviceMeta, CanvasDeviceSnapshot, CanvasPageDto } from "@beacon/shared";
import { CANVAS_COLUMNS, allNeeds, blockDeviceIds, buildSnapshot, canvasRangeLabel } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CanvasView } from "@/canvas/CanvasView";
import { CanvasDataProvider, type CanvasDataValue } from "@/canvas/data";
import { BlockLibrary, BlockPicker } from "@/canvas/editor/BlockLibrary";
import { EditorGrid } from "@/canvas/editor/EditorGrid";
import { BlockInspector, PageInspector } from "@/canvas/editor/Inspector";
import { ShareDialog, pageAddress } from "@/canvas/editor/ShareDialog";
import { makeRoom, newBlockId, placeBlock, tidyUp } from "@/canvas/layout";

/** Makes room for a block that moved or grew, then packs the page upwards. */
function settle(blocks: CanvasBlock[], fixedId: string): CanvasBlock[] {
  return tidyUp(makeRoom(blocks, fixedId));
}

type SaveState = "saved" | "pending" | "saving" | "error";

/**
 * The page's content with undo and redo. Typing into one field is one step,
 * not one per key: changes in the same group within a moment of each other
 * are folded together.
 */
function useHistory(initial: CanvasContent) {
  const [content, setContent] = useState(initial);
  const past = useRef<CanvasContent[]>([]);
  const future = useRef<CanvasContent[]>([]);
  const last = useRef<{ group: string; at: number } | null>(null);
  const [, setVersion] = useState(0);

  const commit = useCallback((next: CanvasContent | ((current: CanvasContent) => CanvasContent), group?: string) => {
    setContent((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value === current) return current;
      const now = Date.now();
      const fold = group && last.current && last.current.group === group && now - last.current.at < 1200;
      if (!fold) {
        past.current = [...past.current.slice(-99), current];
        future.current = [];
      }
      last.current = group ? { group, at: now } : null;
      return value;
    });
    setVersion((value) => value + 1);
  }, []);

  const undo = useCallback(() => {
    setContent((current) => {
      const previous = past.current[past.current.length - 1];
      if (!previous) return current;
      past.current = past.current.slice(0, -1);
      future.current = [current, ...future.current];
      return previous;
    });
    last.current = null;
    setVersion((value) => value + 1);
  }, []);

  const redo = useCallback(() => {
    setContent((current) => {
      const next = future.current[0];
      if (!next) return current;
      future.current = future.current.slice(1);
      past.current = [...past.current, current];
      return next;
    });
    last.current = null;
    setVersion((value) => value + 1);
  }, []);

  const reset = useCallback((value: CanvasContent) => {
    past.current = [];
    future.current = [];
    last.current = null;
    setContent(value);
    setVersion((version) => version + 1);
  }, []);

  return { content, commit, undo, redo, reset, canUndo: past.current.length > 0, canRedo: future.current.length > 0 };
}

function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName);
}

function Editor({ initial, devices }: { initial: CanvasPageDto; devices: CanvasDeviceMeta[] }) {
  const { notify, attempt } = useToast();
  const { samples, statuses } = useLive();
  const wide = useMediaQuery("(min-width: 1280px)");
  const [page, setPage] = useState(initial);
  // An imported page may have gaps the grid would close, so it is packed the same way first.
  const { content, commit, undo, redo, reset, canUndo, canRedo } = useHistory({ ...initial.draft, blocks: tidyUp(initial.draft.blocks) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<CanvasBlockType | null>(null);
  const [picker, setPicker] = useState<{ x: number; y: number; w: number; h: number } | null | false>(false);
  const [preview, setPreview] = useState(false);
  const [previewRange, setPreviewRange] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [publishing, setPublishing] = useState(false);

  /* ---------------------------------------------------------------- data */

  // The editor shows everything a device reports, so any block can be previewed
  // before it is published. What visitors get is cut down by the hub.
  const metas = useMemo(
    () =>
      devices.map((meta) => ({
        ...meta,
        latest: samples[meta.id] ?? meta.latest,
        status: statuses[meta.id]?.status ?? meta.status,
        lastSeenAt: statuses[meta.id]?.lastSeenAt ?? meta.lastSeenAt,
      })),
    [devices, samples, statuses]
  );
  const snapshots = useMemo(() => {
    const needs = allNeeds();
    return Object.fromEntries(metas.map((meta) => [meta.id, buildSnapshot(meta, needs)])) as Record<string, CanvasDeviceSnapshot>;
  }, [metas]);

  const data = useMemo<CanvasDataValue>(
    () => ({
      mode: "editor",
      options: content.options,
      range: previewRange ?? content.options.defaultRange,
      devices: snapshots,
      deviceIds: (block: CanvasBlock) => blockDeviceIds(block, metas),
      fetchSeries: (block, range) => api.canvasPreviewSeries(block, range),
      fetchUptime: (block) => api.canvasPreviewUptime(block, -new Date().getTimezoneOffset()),
      fetchAlerts: (block) => api.canvasPreviewAlerts(block),
    }),
    // Device ids only change when devices are added, which `metas` follows.
    [content.options, previewRange, snapshots, metas]
  );

  /* ------------------------------------------------------------ autosave */

  const saved = useRef(JSON.stringify(initial.draft));
  useEffect(() => {
    const text = JSON.stringify(content);
    if (text === saved.current) return;
    setSaveState("pending");
    const timer = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const summary = await api.saveCanvasDraft(page.id, content);
        saved.current = text;
        setPage((current) => ({ ...current, ...summary, draft: content }));
        setSaveState("saved");
      } catch (error) {
        setSaveState("error");
        notify(error instanceof Error ? error.message : "Could not save the page.", "error");
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [content, page.id, notify]);

  useEffect(() => {
    if (saveState === "saved") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* ------------------------------------------------------------- editing */

  const selected = content.blocks.find((block) => block.id === selectedId) ?? null;
  const firstDevice = devices.find((device) => device.status === "online")?.id ?? devices[0]?.id ?? "";

  const updateBlock = useCallback(
    (block: CanvasBlock, group?: string) => {
      commit(
        (current) => {
          const blocks = current.blocks.map((entry) => (entry.id === block.id ? block : entry));
          const before = current.blocks.find((entry) => entry.id === block.id);
          // A block made bigger from the settings panel pushes what it now covers out of the way.
          const resized = before && (before.w !== block.w || before.h !== block.h);
          return { ...current, blocks: resized ? settle(blocks, block.id) : blocks };
        },
        group ? `${block.id}:${group}` : undefined
      );
    },
    [commit]
  );

  const addBlock = useCallback(
    (type: CanvasBlockType, at: { x: number; y: number; w?: number; h?: number } | null) => {
      let createdId = "";
      commit((current) => {
        const result = placeBlock(current.blocks, type, at, firstDevice);
        createdId = result.id;
        return { ...current, blocks: result.blocks };
      });
      window.setTimeout(() => setSelectedId(createdId), 0);
    },
    [commit, firstDevice]
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      const source = content.blocks.find((block) => block.id === id);
      if (!source) return;
      const copy = { ...structuredClone(source), id: newBlockId(), y: source.y + source.h } as CanvasBlock;
      commit((current) => ({ ...current, blocks: settle([...current.blocks, copy], copy.id) }));
      setSelectedId(copy.id);
    },
    [content.blocks, commit]
  );

  const deleteBlock = useCallback(
    (id: string) => {
      commit((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== id) }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit]
  );

  const applyPositions = useCallback(
    (positions: Map<string, { x: number; y: number; w: number; h: number }>) => {
      commit((current) => {
        let changed = false;
        const blocks = current.blocks.map((block) => {
          const position = positions.get(block.id);
          if (!position) return block;
          if (position.x === block.x && position.y === block.y && position.w === block.w && position.h === block.h) return block;
          changed = true;
          return { ...block, ...position };
        });
        return changed ? { ...current, blocks: tidyUp(blocks) } : current;
      });
    },
    [commit]
  );

  /* ------------------------------------------------------------ keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (preview || isTyping(event.target) || document.querySelector('[role="dialog"][data-state="open"]')) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (!selectedId) {
        return;
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteBlock(selectedId);
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateBlock(selectedId);
      } else if (event.key === "Escape") {
        setSelectedId(null);
      } else if (event.key.startsWith("Arrow")) {
        const block = content.blocks.find((entry) => entry.id === selectedId);
        if (!block) return;
        event.preventDefault();
        let x = block.x;
        let y = block.y;
        if (event.key === "ArrowLeft") x = Math.max(0, block.x - 1);
        else if (event.key === "ArrowRight") x = Math.min(CANVAS_COLUMNS - block.w, block.x + 1);
        else if (event.key === "ArrowUp") {
          // Blocks pack upwards, so up and down trade places with the neighbour.
          if (block.y === 0) return;
          y = block.y - 1;
        } else {
          const below = content.blocks
            .filter((other) => other.id !== block.id && other.y >= block.y + block.h && other.x < block.x + block.w && block.x < other.x + other.w)
            .sort((a, b) => a.y - b.y)[0];
          if (!below) return;
          y = below.y + below.h;
        }
        if (x === block.x && y === block.y) return;
        commit(
          (current) => ({
            ...current,
            blocks: settle(
              current.blocks.map((entry) => (entry.id === block.id ? { ...entry, x, y } : entry)),
              block.id
            ),
          }),
          `${block.id}:nudge`
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview, selectedId, content.blocks, undo, redo, deleteBlock, duplicateBlock, commit]);

  /* ------------------------------------------------------------ publish */

  const dirty = JSON.stringify(content) !== JSON.stringify(page.live);
  const publish = async () => {
    setPublishing(true);
    try {
      if (saveState !== "saved") {
        await api.saveCanvasDraft(page.id, content);
        saved.current = JSON.stringify(content);
        setSaveState("saved");
      }
      const result = await api.publishCanvas(page.id);
      setPage(result);
      notify(page.published ? "Published. Open copies of the page update on their own." : "Published. The page is live.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not publish the page.", "error");
    } finally {
      setPublishing(false);
    }
  };

  const discard = async () => {
    const result = await attempt(() => api.discardCanvasDraft(page.id), "Your changes were thrown away.");
    if (result) {
      setPage(result);
      saved.current = JSON.stringify(result.draft);
      reset(result.draft);
      setSelectedId(null);
    }
  };

  /* -------------------------------------------------------------- layout */

  const address = page.published && page.enabled ? pageAddress(page) : null;
  const badges = page.access === "public" || page.access === "unlisted";
  const inspector = selected ? (
    <BlockInspector
      key={selected.id}
      block={selected}
      onChange={updateBlock}
      onDuplicate={() => duplicateBlock(selected.id)}
      onDelete={() => deleteBlock(selected.id)}
      devices={metas}
      snapshots={snapshots}
      pageUrl={page.published ? pageAddress(page) : null}
      badges={badges}
    />
  ) : (
    <PageInspector content={content} onChange={(next, group) => commit(next, group)} />
  );

  const saveLabel =
    saveState === "saving" ? "Saving…" : saveState === "pending" ? "Unsaved changes" : saveState === "error" ? "Not saved" : "Draft saved";
  const ranges = Array.from(new Set([content.options.defaultRange, ...content.options.visitorRanges])).sort((a, b) => a - b);

  return (
    <CanvasDataProvider value={data}>
      <div className="flex h-[calc(100dvh-3.8rem)] flex-col lg:h-dvh">
        {/* Toolbar */}
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
          <Button asChild variant="ghost" size="icon" aria-label="Back to Canvas pages">
            <Link to="/canvas">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{content.title}</p>
            <p className="flex items-center gap-2 truncate text-2xs text-muted-foreground">
              <span>/p/{page.slug}</span>
              <span className={cn(saveState === "error" && "text-danger")}>{saveLabel}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!preview ? (
              <>
                <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
                  <Undo2 className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
                  <Redo2 className="h-4 w-4" />
                </Button>
                {!wide ? (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setPicker(null)}>
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>
                      <SlidersHorizontal className="h-3.5 w-3.5" /> {selected ? "Block" : "Page"}
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            <Button variant="secondary" size="sm" onClick={() => setPreview(!preview)}>
              {preview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {preview ? "Edit" : "Preview"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setShareOpen(true)}>
              <Share2 className="h-3.5 w-3.5" /> Share
            </Button>
            {address ? (
              <Button asChild variant="ghost" size="icon" title="Open the published page" aria-label="Open the published page">
                <a href={address} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
            {page.published && dirty ? (
              <Button variant="ghost" size="sm" onClick={() => void discard()} title="Go back to what visitors see now">
                Discard
              </Button>
            ) : null}
            <Button variant="primary" size="sm" onClick={() => void publish()} disabled={publishing || (!dirty && page.published)}>
              <Upload className="h-3.5 w-3.5" />
              {publishing ? "Publishing…" : !dirty && page.published ? "Published" : "Publish"}
            </Button>
          </div>
        </div>

        {/* Workspace */}
        <div className="flex min-h-0 flex-1">
          {wide && !preview ? (
            <aside className="scroll-slim w-56 shrink-0 overflow-y-auto border-r border-border/60">
              <BlockLibrary onAdd={(type) => addBlock(type, null)} onDragType={setDragType} />
            </aside>
          ) : null}

          <div className="scroll-slim min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            <div
              className="mx-auto w-full px-3 py-4 sm:px-5"
              style={{ maxWidth: content.options.maxWidth ? content.options.maxWidth + 40 : undefined }}
            >
              {preview ? (
                <>
                  {content.options.showHeader ? (
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h1 className="truncate text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{content.title}</h1>
                        {content.description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{content.description}</p> : null}
                      </div>
                      {ranges.length > 1 ? (
                        <div className="flex rounded-md border border-border bg-surface p-0.5">
                          {ranges.map((seconds) => (
                            <button
                              key={seconds}
                              type="button"
                              onClick={() => setPreviewRange(seconds)}
                              className={cn(
                                "rounded px-2.5 py-1 text-xs font-medium",
                                seconds === (previewRange ?? content.options.defaultRange) ? "bg-surface-3 text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {canvasRangeLabel(seconds)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <CanvasView blocks={content.blocks} />
                </>
              ) : content.blocks.length === 0 && !dragType ? (
                <div className="rounded-lg border border-dashed border-border">
                  <EmptyState
                    icon={LayoutDashboard}
                    title="An empty page"
                    description={wide ? "Drag a block from the left onto the grid, or press the button to pick one." : "Press Add to put your first block on the page."}
                    action={
                      <Button variant="primary" onClick={() => setPicker(null)}>
                        <Plus className="h-4 w-4" /> Add a block
                      </Button>
                    }
                  />
                </div>
              ) : (
                <EditorGrid
                  blocks={content.blocks}
                  selectedId={selectedId}
                  dragType={dragType}
                  onSelect={setSelectedId}
                  onLayout={applyPositions}
                  onDrop={(type, at, positions) => {
                    setDragType(null);
                    let createdId = "";
                    commit((current) => {
                      const moved = current.blocks.map((block) => ({ ...block, ...(positions.get(block.id) ?? {}) }));
                      const result = placeBlock(moved, type, at, firstDevice);
                      createdId = result.id;
                      return { ...current, blocks: result.blocks };
                    });
                    window.setTimeout(() => setSelectedId(createdId), 0);
                  }}
                  onAddAt={(at) => setPicker(at)}
                  onDuplicate={duplicateBlock}
                  onDelete={deleteBlock}
                />
              )}
              {!preview && !wide ? (
                <p className="mt-4 text-center text-2xs text-muted-foreground">The editor is easiest to use on a wider screen. Visitors on phones get a layout made for them.</p>
              ) : null}
            </div>
          </div>

          {wide && !preview ? (
            <aside className="scroll-slim w-80 shrink-0 overflow-y-auto border-l border-border/60">{inspector}</aside>
          ) : null}
        </div>
      </div>

      <BlockPicker
        open={picker !== false}
        onOpenChange={(open) => {
          if (!open) setPicker(false);
        }}
        onPick={(type) => {
          addBlock(type, picker === false ? null : picker);
          setPicker(false);
        }}
      />

      {!wide ? (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="max-w-md p-0 sm:p-0">
            <div className="px-4 pt-4">
              <DialogHeader title={selected ? "Block settings" : "Page settings"} />
            </div>
            {inspector}
          </DialogContent>
        </Dialog>
      ) : null}

      <ShareDialog page={page} open={shareOpen} onOpenChange={setShareOpen} onPage={(next) => setPage((current) => ({ ...next, draft: current.draft }))} />
    </CanvasDataProvider>
  );
}

export function CanvasEditorPage() {
  const { id = "" } = useParams();
  const [page, setPage] = useState<CanvasPageDto | null>(null);
  const [devices, setDevices] = useState<CanvasDeviceMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.canvasPage(id), api.canvasDevices()])
      .then(([loadedPage, loadedDevices]) => {
        if (cancelled) return;
        setPage(loadedPage);
        setDevices(loadedDevices);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not open this page.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error) {
    return (
      <EmptyState
        icon={LayoutDashboard}
        title="This page could not be opened"
        description={error}
        action={
          <Button asChild variant="secondary">
            <Link to="/canvas">Back to Canvas</Link>
          </Button>
        }
      />
    );
  }
  if (!page || !devices) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <Editor initial={page} devices={devices} />;
}

