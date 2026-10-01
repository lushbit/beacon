import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Github, Lock, LogIn, RadioTower, SearchX } from "lucide-react";
import type {
  CanvasAlertsDto,
  CanvasBlock,
  CanvasDeviceSnapshot,
  CanvasLiveMessage,
  CanvasSeriesDto,
  CanvasUptimeDto,
  PublicCanvasDto,
} from "@beacon/shared";
import { BEACON_VERSION, CANVAS_RANGES } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { noteServerTime } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { BlockView } from "./BlockView";
import { CanvasHeader, PAGE_COLUMN, pageColumnStyle } from "./CanvasHeader";
import { CanvasView } from "./CanvasView";
import { CanvasDataProvider, type CanvasDataValue } from "./data";

/** `/p/<slug>` for a page, `/p/<slug>/b/<block>` for one block of it. */
function readLocation() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(window.location.search);
  const rangeParam = params.get("range") ?? "";
  const range =
    CANVAS_RANGES.find((entry) => entry.label === rangeParam || String(entry.seconds) === rangeParam)?.seconds ?? null;
  return {
    slug: (parts[1] ?? "").toLowerCase(),
    blockId: parts[2] === "b" ? (parts[3] ?? null) : null,
    key: params.get("key") ?? "",
    kiosk: params.has("kiosk"),
    transparent: params.get("theme") === "transparent",
    range,
  };
}

const where = readLocation();
const TOKEN_KEY = `beacon.canvas.token.${where.slug}`;

function storedToken(): string {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

class PublicError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

async function publicRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (where.key) headers["X-Canvas-Key"] = where.key;
  const token = storedToken();
  if (token) headers["X-Canvas-Token"] = token;
  if (init?.body) headers["Content-Type"] = "application/json";
  const sentAt = Date.now();
  const response = await fetch(`/api/public/canvas/${encodeURIComponent(where.slug)}${path}`, {
    credentials: "same-origin",
    ...init,
    headers,
  });
  noteServerTime(Number(response.headers.get("X-Beacon-Time")), sentAt, Date.now());
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const body = (data ?? {}) as { error?: string; code?: string };
    throw new PublicError(body.error ?? `Request failed (${response.status})`, response.status, body.code ?? "");
  }
  return data as T;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; page: PublicCanvasDto }
  | { kind: "password" }
  | { kind: "signin" }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-full items-center justify-center px-4 py-12">{children}</div>;
}

function PasswordPrompt({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token } = await publicRequest<{ token: string }>("/unlock", { method: "POST", body: JSON.stringify({ password }) });
      try {
        window.sessionStorage.setItem(TOKEN_KEY, token);
      } catch {
        /* without storage the password is asked for again on the next visit */
      }
      onUnlocked();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not check the password.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Centered>
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg border border-border bg-card p-6">
        <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2">
          <Lock className="h-4 w-4 text-foreground" />
        </span>
        <h1 className="text-base font-semibold text-foreground">This page is protected</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter the password you were given to open it.</p>
        <Input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-4"
          aria-label="Password"
        />
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || !password}>
          {busy ? "Checking…" : "Open page"}
        </Button>
      </form>
    </Centered>
  );
}

function Notice({ icon: Icon, title, text, action }: { icon: typeof Lock; title: string; text: string; action?: React.ReactNode }) {
  return (
    <Centered>
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </span>
        <h1 className="text-base font-semibold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{text}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </Centered>
  );
}

/** Where Beacon itself lives, for the footer. */
const PROJECT_URL = "https://github.com/lushbit/beacon";

/**
 * The line under every page: what made it, then buttons for the project and
 * for the hub the page is served from, with the version between them.
 */
function PageFooter() {
  return (
    <footer className="mt-10 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-border/50 pt-5 text-2xs text-muted-foreground/80">
      <span>
        Made with <span className="font-medium text-muted-foreground">Beacon</span> by lushbit
      </span>
      <div className="flex items-center gap-2">
        <Button asChild variant="outline" size="sm" className="h-7 w-7 px-0 text-muted-foreground hover:text-foreground">
          <a href={PROJECT_URL} target="_blank" rel="noopener noreferrer" title="Beacon on GitHub" aria-label="Beacon on GitHub">
            <Github className="h-3.5 w-3.5" />
          </a>
        </Button>
        <span className="tabular">v{BEACON_VERSION}</span>
        <Button asChild variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-2xs text-muted-foreground hover:text-foreground">
          <a href="/" target={window.top !== window ? "_blank" : undefined} rel="noopener">
            <RadioTower className="h-3.5 w-3.5" />
            {window.location.host}
          </a>
        </Button>
      </div>
    </footer>
  );
}

function socketUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({ slug: where.slug });
  if (where.key) params.set("key", where.key);
  const token = storedToken();
  if (token) params.set("token", token);
  return `${protocol}//${window.location.host}/live/canvas?${params}`;
}

export default function PublicCanvasApp() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [devices, setDevices] = useState<Record<string, CanvasDeviceSnapshot>>({});
  const [range, setRange] = useState<number | null>(where.range);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    try {
      const page = await publicRequest<PublicCanvasDto>("");
      setDevices(Object.fromEntries(page.devices.map((device) => [device.id, device])));
      setUpdatedAt(Date.now());
      setState({ kind: "ready", page });
      document.title = page.content.title;
    } catch (caught) {
      if (caught instanceof PublicError && caught.code === "password") {
        try {
          window.sessionStorage.removeItem(TOKEN_KEY);
        } catch {
          /* nothing stored, nothing to clear */
        }
        setState({ kind: "password" });
      } else if (caught instanceof PublicError && caught.code === "signin") setState({ kind: "signin" });
      else if (caught instanceof PublicError && caught.status === 404) setState({ kind: "missing" });
      else setState({ kind: "error", message: caught instanceof Error ? caught.message : "Could not load this page." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, generation]);

  // A transparent page lets the site it is embedded in show through.
  useEffect(() => {
    if (!where.transparent) return;
    for (const element of [document.documentElement, document.body, document.getElementById("root")]) {
      if (element) element.style.background = "transparent";
    }
  }, []);

  /*
   * Live updates over the page's socket. When it cannot connect, such as
   * behind a proxy that drops upgrades, the page asks for fresh numbers every
   * ten seconds instead of standing still.
   */
  const ready = state.kind === "ready";
  const failures = useRef(0);
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let poll: number | undefined;

    const startPolling = () => {
      if (poll !== undefined) return;
      poll = window.setInterval(async () => {
        if (document.visibilityState === "hidden") return;
        try {
          const live = await publicRequest<{ devices: CanvasDeviceSnapshot[] }>("/live");
          setDevices(Object.fromEntries(live.devices.map((device) => [device.id, device])));
          setUpdatedAt(Date.now());
        } catch {
          /* keep showing the last numbers */
        }
      }, 10_000);
    };

    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(socketUrl());
      socket.onopen = () => {
        failures.current = 0;
        if (poll !== undefined) {
          window.clearInterval(poll);
          poll = undefined;
        }
      };
      socket.onmessage = (event: MessageEvent<string>) => {
        let message: CanvasLiveMessage;
        try {
          message = JSON.parse(event.data) as CanvasLiveMessage;
        } catch {
          return;
        }
        if (message.type === "snapshot") {
          setDevices((current) => ({ ...current, [message.device.id]: message.device }));
          setUpdatedAt(Date.now());
        } else if (message.type === "status") {
          setDevices((current) => {
            const device = current[message.deviceId];
            if (!device) return current;
            return { ...current, [message.deviceId]: { ...device, status: message.status, lastSeenAt: message.lastSeenAt } };
          });
        } else if (message.type === "reload") {
          // The admin published a new version. Show it without a refresh.
          disposed = true;
          setGeneration((value) => value + 1);
        }
      };
      socket.onclose = () => {
        socket = null;
        if (disposed) return;
        failures.current += 1;
        if (failures.current >= 3) startPolling();
        retry = window.setTimeout(connect, Math.min(30_000, 1000 * 2 ** failures.current));
      };
      socket.onerror = () => socket?.close();
    };
    connect();

    return () => {
      disposed = true;
      if (retry !== undefined) window.clearTimeout(retry);
      if (poll !== undefined) window.clearInterval(poll);
      socket?.close();
    };
  }, [ready, generation]);

  const page = state.kind === "ready" ? state.page : null;
  const options = page?.content.options;
  const activeRange = range ?? options?.defaultRange ?? 3600;

  const data = useMemo<CanvasDataValue | null>(() => {
    if (!page || !options) return null;
    return {
      mode: "public",
      options,
      range: activeRange,
      devices,
      deviceIds: (block: CanvasBlock) => page.blockDevices[block.id] ?? [],
      fetchSeries: (block: CanvasBlock, seconds: number) =>
        publicRequest<CanvasSeriesDto>(`/blocks/${encodeURIComponent(block.id)}/series?range=${seconds}`),
      fetchUptime: (block: CanvasBlock) =>
        publicRequest<CanvasUptimeDto>(`/blocks/${encodeURIComponent(block.id)}/uptime?tz=${-new Date().getTimezoneOffset()}`),
      fetchAlerts: (block: CanvasBlock) => publicRequest<CanvasAlertsDto>(`/blocks/${encodeURIComponent(block.id)}/alerts`),
    };
  }, [page, options, activeRange, devices]);

  if (state.kind === "loading") {
    return (
      <Centered>
        <span className="flex h-11 w-11 animate-pulse items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/10">
          <RadioTower className="h-5 w-5 text-foreground" />
        </span>
      </Centered>
    );
  }
  if (state.kind === "password") return <PasswordPrompt onUnlocked={() => setGeneration((value) => value + 1)} />;
  if (state.kind === "signin") {
    return (
      <Notice
        icon={LogIn}
        title="Sign in to see this page"
        text="This page is only shared with people who have an account on this Beacon."
        action={
          <Button asChild variant="primary">
            <a href={`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`} target={window.top !== window ? "_blank" : undefined} rel="noopener">
              Sign in
            </a>
          </Button>
        }
      />
    );
  }
  if (state.kind === "missing") {
    return <Notice icon={SearchX} title="This page is not available" text="The address may be wrong, or the page was taken down." />;
  }
  if (state.kind === "error" || !page || !options || !data) {
    return (
      <Notice
        icon={SearchX}
        title="This page could not be loaded"
        text={state.kind === "error" ? state.message : "Try again in a moment."}
        action={
          <Button variant="secondary" onClick={() => setGeneration((value) => value + 1)}>
            Try again
          </Button>
        }
      />
    );
  }

  // One block on its own, filling the frame it is embedded in.
  if (where.blockId) {
    const block = page.content.blocks.find((entry) => entry.id === where.blockId);
    return (
      <CanvasDataProvider value={data}>
        <div className="h-full w-full overflow-hidden p-2">
          {block ? <BlockView block={block} /> : <Notice icon={SearchX} title="This block is not on the page any more" text="It may have been removed when the page was last published." />}
        </div>
      </CanvasDataProvider>
    );
  }

  const showHeader = options.showHeader && !where.kiosk;

  return (
    <CanvasDataProvider value={data}>
      <div className="scroll-slim h-full overflow-y-auto overflow-x-hidden">
        <div className={cn(PAGE_COLUMN, where.kiosk ? "py-3" : "py-5 sm:py-8")} style={pageColumnStyle(options.maxWidth)}>
          {showHeader ? <CanvasHeader content={page.content} range={activeRange} onRange={setRange} updatedAt={updatedAt} /> : null}
          <CanvasView blocks={page.content.blocks} />
          {where.kiosk ? null : <PageFooter />}
        </div>
      </div>
    </CanvasDataProvider>
  );
}
