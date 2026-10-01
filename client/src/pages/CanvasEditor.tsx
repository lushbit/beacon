import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Settings2,
  type LucideIcon,
  Undo2,
  Upload,
} from "lucide-react";
import type { CanvasBlock, CanvasBlockType, CanvasContent, CanvasDeviceMeta, CanvasDeviceSnapshot, CanvasPageDto } from "@beacon/shared";
import { CANVAS_BLOCK_INFO, allNeeds, blockDeviceIds, buildSnapshot, clampBlock } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { EmptyState, Skeleton } from "@/components/ui/misc";
import { useLive } from "@/context/LiveContext";
import { useToast } from "@/context/ToastContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CanvasHeader, PAGE_COLUMN } from "@/canvas/CanvasHeader";
import { CanvasView } from "@/canvas/CanvasView";
import { useBoxSize } from "@/canvas/useBoxSize";
import { CanvasDataProvider, type CanvasDataValue } from "@/canvas/data";
import { BLOCK_ICONS, BlockLibrary, BlockPicker } from "@/canvas/editor/BlockLibrary";
import { EditorGrid } from "@/canvas/editor/EditorGrid";
import { BlockInspector, PageInspector } from "@/canvas/editor/Inspector";
import { ShareDialog, pageAddress } from "@/canvas/editor/ShareDialog";
import { isFree, makeRoom, newBlockId, nudge, placeBlock } from "@/canvas/layout";

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
  const [page, setPage] = useState(initial);
  // A page saved before the size limits existed may hold blocks outside them,
  // so they are brought within them first.
  const { content, commit, undo, redo, reset, canUndo, canRedo } = useHistory({ ...initial.draft, blocks: initial.draft.blocks.map(clampBlock) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<CanvasBlockType | null>(null);
  const [picker, setPicker] = useState<{ col: number; row: number } | null | false>(false);
  const [preview, setPreview] = useState(false);
  const [previewRange, setPreviewRange] = useState<number | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(() => sidebarDefault(LIBRARY_KEY, 1700));
  const [settingsOpen, setSettingsOpen] = useState(() => sidebarDefault(SETTINGS_KEY, 1024));
  const [settingsTab, setSettingsTab] = useState<"block" | "page">("page");
  const toggleLibrary = (open: boolean) => {
    setLibraryOpen(open);
    rememberSidebar(LIBRARY_KEY, open);
  };
  const toggleSettings = (open: boolean) => {
    setSettingsOpen(open);
    rememberSidebar(SETTINGS_KEY, open);
  };
  // Picking a block brings up its settings, opening the sidebar if it was
  // folded away. Clicking off it shows the page's settings instead.
  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    setSettingsTab(id ? "block" : "page");
    if (id) {
      setSettingsOpen(true);
      rememberSidebar(SETTINGS_KEY, true);
    }
  }, []);
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
          return { ...current, blocks: resized ? makeRoom(blocks, block.id) : blocks };
        },
        group ? `${block.id}:${group}` : undefined
      );
    },
    [commit]
  );

  const addBlock = useCallback(
    (type: CanvasBlockType, at: { col: number; row: number } | { x: number; y: number; w: number; h: number } | null) => {
      let createdId = "";
      commit((current) => {
        const result = placeBlock(current.blocks, type, at, firstDevice);
        createdId = result.id;
        return { ...current, blocks: result.blocks };
      });
      window.setTimeout(() => select(createdId), 0);
    },
    [commit, firstDevice, select]
  );

  const duplicateBlock = useCallback(
    (id: string) => {
      const source = content.blocks.find((block) => block.id === id);
      if (!source) return;
      // Beside the original if there is room, otherwise under it.
      const beside = { x: source.x + source.w, y: source.y, w: source.w, h: source.h };
      const spot = isFree(content.blocks, beside) ? beside : { ...beside, x: source.x, y: source.y + source.h };
      const copy = { ...structuredClone(source), id: newBlockId(), x: spot.x, y: spot.y } as CanvasBlock;
      commit((current) => ({ ...current, blocks: makeRoom([...current.blocks, copy], copy.id) }));
      select(copy.id);
    },
    [content.blocks, commit, select]
  );

  const deleteBlock = useCallback(
    (id: string) => {
      commit((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== id) }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [commit]
  );

  const applyPositions = useCallback(
    (positions: Map<string, { x: number; y: number; w: number; h: number }>, movedId: string) => {
      commit((current) => {
        let changed = false;
        const blocks = current.blocks.map((block) => {
          const position = positions.get(block.id);
          if (!position) return block;
          if (position.x === block.x && position.y === block.y && position.w === block.w && position.h === block.h) return block;
          changed = true;
          return { ...block, ...position };
        });
        return changed ? { ...current, blocks: makeRoom(blocks, movedId) } : current;
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
        const dx = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
        const dy = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
        // A block stops at the edges of the page and pushes aside what it lands on.
        if (!nudge(content.blocks, block.id, dx, dy)) return;
        commit((current) => ({ ...current, blocks: nudge(current.blocks, block.id, dx, dy) ?? current.blocks }), `${block.id}:nudge`);
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
  const updatedAt = Math.max(0, ...Object.values(snapshots).map((snapshot) => snapshot.ts ?? 0)) || null;
  const range = previewRange ?? content.options.defaultRange;

  /*
   * The page is laid out at the width a visitor's window gives it and then
   * shrunk to fit between the sidebars, so a block that fits here fits on the
   * published page too, however far the sidebars are open.
   */
  const windowWidth = useWindowWidth();
  const designWidth = content.options.maxWidth ? Math.min(content.options.maxWidth + 40, windowWidth) : windowWidth;
  const [stageRef, stage] = useBoxSize<HTMLDivElement>();
  const [pageRef, pageSize] = useBoxSize<HTMLDivElement>();
  const scale = stage.width > 0 ? Math.min(1, stage.width / designWidth) : 1;

  const SelectedIcon = selected ? BLOCK_ICONS[selected.type] : null;
  const showBlockTab = settingsTab === "block" && selected !== null;

  return (
    <CanvasDataProvider value={data}>
      <div className="flex h-dvh flex-col">
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

        <div className="flex min-h-0 flex-1">
          {!preview ? (
            <Sidebar side="left" open={libraryOpen} onToggle={() => toggleLibrary(!libraryOpen)} label="block list" railIcon={Plus} header="Blocks">
              <BlockLibrary onAdd={(type) => addBlock(type, null)} onDragType={setDragType} />
            </Sidebar>
          ) : null}

          <div ref={stageRef} className="relative min-w-0 flex-1">
            <div
              className="scroll-slim absolute inset-0 overflow-y-auto overflow-x-hidden"
              data-backdrop
              onClick={(event) => {
                if ((event.target as HTMLElement).dataset.backdrop !== undefined) select(null);
              }}
            >
              {/* Takes the shrunken height, so the scroll bar matches what is on screen. */}
              <div className="mx-auto" style={{ width: designWidth * scale, height: pageSize.height * scale }} data-backdrop>
                <div
                  ref={pageRef}
                  className={cn(PAGE_COLUMN, "relative py-5 sm:py-8")}
                  style={{ width: designWidth, maxWidth: "none", transform: scale < 1 ? `scale(${scale})` : undefined, transformOrigin: "top left" }}
                  data-backdrop
                >
                  {content.options.showHeader ? (
                    <CanvasHeader content={content} range={range} onRange={setPreviewRange} updatedAt={updatedAt} />
                  ) : null}
                  {preview ? (
                    <CanvasView blocks={content.blocks} />
                  ) : content.blocks.length === 0 && !dragType ? (
                    <div className="rounded-lg border border-dashed border-border">
                      <EmptyState
                        icon={LayoutDashboard}
                        title="An empty page"
                        description="Drag a block from the block list onto the page, or pick one with the button."
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
                      onSelect={select}
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
                        window.setTimeout(() => select(createdId), 0);
                      }}
                      onAddAt={(cell) => setPicker(cell)}
                      onBackground={() => select(null)}
                      onDuplicate={duplicateBlock}
                      onDelete={deleteBlock}
                      scale={scale}
                      fillHeight={stage.height / scale}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          {!preview ? (
            <Sidebar
              side="right"
              open={settingsOpen}
              onToggle={() => toggleSettings(!settingsOpen)}
              label="settings"
              railIcon={Settings2}
              header={
                <div className="flex w-full rounded-md border border-border bg-surface-2 p-0.5" role="tablist" aria-label="Settings">
                  {(["block", "page"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={(tab === "block") === showBlockTab}
                      disabled={tab === "block" && !selected}
                      title={tab === "block" && !selected ? "Click a block on the page first" : undefined}
                      onClick={() => setSettingsTab(tab)}
                      className={cn(
                        "flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 text-xs font-medium transition-colors disabled:opacity-40",
                        (tab === "block") === showBlockTab ? "bg-surface-3 text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {tab === "block" ? (
                        <>
                          {SelectedIcon ? <SelectedIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                          <span className="truncate">{selected ? selected.title || CANVAS_BLOCK_INFO[selected.type].label : "Block"}</span>
                        </>
                      ) : (
                        "Page"
                      )}
                    </button>
                  ))}
                </div>
              }
            >
              {showBlockTab && selected ? (
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
              )}
            </Sidebar>
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

      <ShareDialog page={page} open={shareOpen} onOpenChange={setShareOpen} onPage={(next) => setPage((current) => ({ ...next, draft: current.draft }))} />
    </CanvasDataProvider>
  );
}

/**
 * A sidebar beside the page, like the dashboard's own. Folded, it is a thin
 * rail with a button to open it again, so it never sits on top of a block.
 */
function Sidebar({
  side,
  open,
  onToggle,
  label,
  railIcon: RailIcon,
  header,
  children,
}: {
  side: "left" | "right";
  open: boolean;
  onToggle: () => void;
  label: string;
  railIcon: LucideIcon;
  header: ReactNode;
  children: ReactNode;
}) {
  const Fold = side === "left" ? (open ? PanelLeftClose : PanelLeftOpen) : open ? PanelRightClose : PanelRightOpen;
  const toggle = (
    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onToggle} title={open ? `Fold the ${label} away` : `Open the ${label}`} aria-label={open ? `Fold the ${label} away` : `Open the ${label}`}>
      <Fold className="h-4 w-4" />
    </Button>
  );
  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col border-border/60 bg-surface/40 transition-[width] duration-200 ease-out",
        side === "left" ? "border-r" : "border-l",
        open ? (side === "left" ? "w-56" : "w-80") : "w-12"
      )}
    >
      {open ? (
        <>
          <div className={cn("flex h-12 shrink-0 items-center gap-2 border-b border-border/60 px-2", side === "left" ? "pl-4" : "flex-row-reverse pr-3")}>
            <div className="flex min-w-0 flex-1 items-center text-sm font-semibold text-foreground">{header}</div>
            {toggle}
          </div>
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">{children}</div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-1 py-2">
          {toggle}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggle} title={`Open the ${label}`} aria-label={`Open the ${label}`}>
            <RailIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
    </aside>
  );
}

const LIBRARY_KEY = "beacon.canvas.library";
const SETTINGS_KEY = "beacon.canvas.settings";

/**
 * Open unless folded away before. Each opens on its own only on a window wide
 * enough that the page does not have to shrink much to make room for it.
 */
function sidebarDefault(key: string, minWidth: number): boolean {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored !== null) return stored === "1";
  } catch {
    /* falls back to the width of the window */
  }
  return window.innerWidth >= minWidth;
}

function rememberSidebar(key: string, open: boolean): void {
  try {
    window.localStorage.setItem(key, open ? "1" : "0");
  } catch {
    /* the choice just will not be remembered */
  }
}

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
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

