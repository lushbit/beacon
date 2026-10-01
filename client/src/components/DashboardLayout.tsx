import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowUpCircle,
  Bell,
  ExternalLink,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  RotateCw,
  Settings2,
  Tag,
  Users as UsersIcon,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AlertSummaryDto } from "@beacon/shared";
import { Button } from "@/components/ui/button";
import { UpdateNotices } from "@/components/UpdateNotices";
import { useAuth } from "@/context/AuthContext";
import { useLive } from "@/context/LiveContext";
import { useVersion } from "@/context/VersionContext";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const NO_ALERTS: AlertSummaryDto = { active: 0, unacknowledged: 0, unreadActive: 0, unreadHistory: 0 };

/**
 * Counts for the badge beside Alerts. They are re-read when an alert arrives on
 * the socket and when this account marks the Alerts page as seen, with a slow
 * timer underneath for anything neither of those catches, such as an alert
 * acknowledged in another browser.
 */
function useAlertSummary(): AlertSummaryDto {
  const { session, preferences } = useAuth();
  const { lastAlert } = useLive();
  const [summary, setSummary] = useState<AlertSummaryDto>(NO_ALERTS);

  useEffect(() => {
    if (!session) {
      setSummary(NO_ALERTS);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const next = await api.alertSummary();
        if (!cancelled) setSummary(next);
      } catch {
        /* keep the last counts rather than blanking the badge */
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session, preferences.alertsActiveSeenAt, preferences.alertsHistorySeenAt, lastAlert?.id]);

  return summary;
}

/**
 * Something is firing: a red count, ringing while nobody has acknowledged it.
 * Nothing firing but alerts this account has not seen: a plain count instead.
 */
function AlertBadge({
  active,
  unacknowledged,
  unreadActive,
  unreadHistory,
  compact = false,
}: AlertSummaryDto & { compact?: boolean }) {
  const unread = unreadActive + unreadHistory;
  const firing = active > 0;
  const count = firing ? active : unread;
  if (count === 0) return null;

  const label = firing
    ? `${active} active alert${active === 1 ? "" : "s"}${unacknowledged > 0 ? `, ${unacknowledged} not acknowledged yet` : ""}`
    : `${unread} alert${unread === 1 ? "" : "s"} you have not read`;

  return (
    <span
      className={cn("flex shrink-0 items-center", compact ? "absolute -right-0.5 -top-0.5" : "relative ml-auto")}
      title={label}
    >
      {firing && unacknowledged > 0 ? (
        <span className="absolute inset-0 animate-pulse-ring rounded-full bg-danger/60" aria-hidden />
      ) : null}
      <span
        className={cn(
          "relative flex items-center justify-center rounded-full font-semibold tabular",
          compact ? "min-w-[1rem] px-1 text-[0.625rem] leading-4" : "min-w-[1.25rem] px-1.5 py-0.5 text-2xs",
          firing ? "bg-danger/15 text-danger ring-1 ring-inset ring-danger/40" : "bg-white/[0.08] text-muted-foreground"
        )}
      >
        {count > 99 ? "99+" : count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

function NewPill({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground" title="NEW" aria-label="New" />
    );
  }
  return (
    <span className="relative ml-auto shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-2xs font-semibold text-foreground ring-1 ring-inset ring-white/15">
      NEW
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
  /** Shows a "NEW" pill beside the label, for a recently added page. */
  isNew?: boolean;
}

const NAVIGATE: NavItem[] = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/canvas", label: "Canvas", icon: LayoutDashboard, adminOnly: true, isNew: true },
];

const MANAGE: NavItem[] = [
  { to: "/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

function SidebarLink({
  item,
  onNavigate,
  scope,
  badge,
  collapsed,
}: {
  item: NavItem;
  onNavigate?: () => void;
  scope: string;
  badge?: React.ReactNode;
  collapsed: boolean;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      aria-label={collapsed ? item.label : undefined}
    >
      {({ isActive }) => (
        <span
          className={cn(
            // A fixed height rather than padding around the label, because
            // collapsed there is no label and the row would come out shorter.
            "group relative flex h-10 items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-200",
            "px-3",
            isActive ? "text-foreground" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"
          )}
        >
          {isActive ? (
            <motion.span
              layoutId={`sidebar-active-${scope}`}
              transition={{ type: "spring", stiffness: 420, damping: 34 }}
              className="absolute inset-0 rounded-xl border border-white/10 bg-white/[0.07]"
            />
          ) : null}
          <Icon
            className={cn(
              "relative h-[1.05rem] w-[1.05rem] shrink-0 transition-colors",
              isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
            )}
          />
          {collapsed ? null : <span className="relative truncate">{item.label}</span>}
          {badge}
          {item.isNew && !badge ? <NewPill compact={collapsed} /> : null}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Collapsed, the heading would not fit, so a single dot stands in for it. The
 * dot sits in the same box as the text, so every link below stays at the same
 * height in both widths and nothing jumps when the sidebar opens or closes.
 */
function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed: boolean }) {
  return (
    <p className="px-3 pb-2 pt-5 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
      <span className="relative block">
        <span className={cn("whitespace-nowrap", collapsed && "invisible")}>{children}</span>
        {collapsed ? (
          <span
            className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/50"
            aria-hidden
          />
        ) : null}
      </span>
    </p>
  );
}

/**
 * `scope` keeps the active pill's `layoutId` unique per instance. The desktop
 * sidebar stays mounted at every width (it is only hidden with `lg:block`), so
 * opening the mobile drawer puts a second copy of every link in the tree. Two
 * elements sharing one `layoutId` make framer-motion animate between them, and
 * the hidden copy measures zero, which wedges the projection and can leave the
 * drawer's exit animation unfinished.
 */
function SidebarContent({
  onNavigate,
  scope,
  alerts,
  collapsed = false,
  onToggleCollapsed,
}: {
  onNavigate?: () => void;
  scope: string;
  alerts: AlertSummaryDto;
  /** Desktop only: the sidebar narrowed to its icons. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const { session, signOut, siteName } = useAuth();
  const { info, appVersion, needsReload } = useVersion();
  const isAdmin = session?.user.role === "admin";
  const version = info?.current ?? appVersion;
  const sourceUrl = info?.sourceUrl ?? null;

  return (
    <div className="flex h-full flex-col">
      {/*
       * One row of the same height in both widths, with the logo at the same
       * spot, so the links under it never move. Collapsed, the logo itself is
       * the button that opens the sidebar again.
       */}
      <div className="mb-2 mt-1 flex h-8 items-center gap-1 pl-1">
        {collapsed && onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="group flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10 transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <RadioTower className="h-4 w-4 text-foreground group-hover:hidden group-focus-visible:hidden" />
            <PanelLeftOpen className="hidden h-4 w-4 text-foreground group-hover:block group-focus-visible:block" />
          </button>
        ) : (
          <>
            <Link to="/" onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10">
                <RadioTower className="h-4 w-4 text-foreground" />
              </span>
              <span className="truncate whitespace-nowrap text-sm font-semibold tracking-tight text-foreground">
                {siteName}
              </span>
            </Link>
            {onToggleCollapsed ? (
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleCollapsed}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="h-8 w-8 shrink-0 text-muted-foreground"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            ) : null}
          </>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scroll-slim">
        <SectionLabel collapsed={collapsed}>Navigate</SectionLabel>
        <div className="space-y-1">
          {NAVIGATE.map((item) => (
            <SidebarLink
              key={item.to}
              item={item}
              onNavigate={onNavigate}
              scope={scope}
              collapsed={collapsed}
              badge={item.to === "/alerts" ? <AlertBadge {...alerts} compact={collapsed} /> : null}
            />
          ))}
        </div>

        <SectionLabel collapsed={collapsed}>Manage</SectionLabel>
        <div className="space-y-1">
          {MANAGE.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} scope={scope} collapsed={collapsed} />
          ))}
        </div>
      </nav>

      {collapsed ? (
        <CompactFooter
          version={version}
          sourceUrl={sourceUrl}
          needsReload={needsReload}
          latest={info?.updateAvailable ? (info.latest?.version ?? null) : null}
        />
      ) : (
        <div className="space-y-3 border-t border-border/60 px-3 pb-2 pt-3">
          {needsReload ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex w-full items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2 text-left text-2xs text-warning transition-colors hover:bg-warning/15"
            >
              <RotateCw className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Dashboard updated — reload</span>
            </button>
          ) : null}
          {info?.updateAvailable && info.latest ? (
            <Link
              to="/settings?tab=about"
              onClick={onNavigate}
              className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-2.5 py-2 text-2xs text-info transition-colors hover:bg-info/15"
            >
              <ArrowUpCircle className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Version {info.latest.version} available</span>
            </Link>
          ) : null}
          <a
            href={sourceUrl ?? "#"}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={sourceUrl ? undefined : true}
            onClick={(event) => {
              if (!sourceUrl) event.preventDefault();
            }}
            title={sourceUrl ? "Open the Beacon source repository" : "Beacon version"}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg border border-border/70 bg-surface-2 px-3 py-2.5 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              sourceUrl ? "hover:border-border hover:bg-surface-3" : "cursor-default"
            )}
          >
            <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-2xs uppercase tracking-[0.14em] text-muted-foreground">Version</span>
              <span className="block truncate text-sm font-semibold tabular text-foreground">v{version}</span>
            </span>
            {sourceUrl ? <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
          </a>
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold uppercase text-foreground ring-1 ring-inset ring-white/10">
              {(session?.user.displayName ?? "?").slice(0, 1)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground">{session?.user.displayName}</p>
              <p className="truncate text-2xs capitalize text-muted-foreground">{session?.user.role}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Sign out"
              onClick={() => void signOut()}
              className="h-8 w-8 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The footer of the narrow sidebar: the same notices as icons, the version
 * shortened to its number, and the account as its initial with sign out below.
 */
function CompactFooter({
  version,
  sourceUrl,
  needsReload,
  latest,
}: {
  version: string;
  sourceUrl: string | null;
  needsReload: boolean;
  latest: string | null;
}) {
  const { session, signOut } = useAuth();
  const name = session?.user.displayName ?? "?";

  return (
    <div className="flex flex-col items-center gap-2 border-t border-border/60 pb-2 pt-3">
      {needsReload ? (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => window.location.reload()}
          aria-label="Dashboard updated, reload"
          title="Dashboard updated, reload"
          className="h-8 w-8 text-warning hover:bg-warning/15 hover:text-warning"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
      ) : null}
      {latest ? (
        <Link
          to="/settings?tab=about"
          aria-label={`Version ${latest} available`}
          title={`Version ${latest} available`}
          className="flex h-8 w-8 items-center justify-center rounded-md text-info transition-colors hover:bg-info/15"
        >
          <ArrowUpCircle className="h-4 w-4" />
        </Link>
      ) : null}
      <a
        href={sourceUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        aria-disabled={sourceUrl ? undefined : true}
        onClick={(event) => {
          if (!sourceUrl) event.preventDefault();
        }}
        title={sourceUrl ? `Beacon v${version}. Open the source repository` : `Beacon v${version}`}
        className={cn(
          // The column is narrower than the number, so the label borrows the
          // sidebar's side padding rather than cutting the version short.
          "-mx-3 whitespace-nowrap rounded-md px-1 py-1 text-[0.625rem] font-medium tabular text-muted-foreground transition-colors",
          sourceUrl ? "hover:bg-white/[0.05] hover:text-foreground" : "cursor-default"
        )}
      >
        v{version}
      </a>
      <span
        title={`${name} (${session?.user.role ?? ""})`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-xs font-semibold uppercase text-foreground ring-1 ring-inset ring-white/10"
      >
        {name.slice(0, 1)}
      </span>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Sign out"
        title="Sign out"
        onClick={() => void signOut()}
        className="h-8 w-8 shrink-0"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

/**
 * Route changes used to swap the page in mid-scroll: the new page inherited the
 * old scroll offset and then snapped once its own content arrived. The scroll
 * is reset before the browser paints, and the incoming page fades in over a
 * container that is always at least a screen tall, so the swap never collapses
 * the layout underneath it.
 */
function PageTransition({ scrollRef }: { scrollRef: React.RefObject<HTMLElement> }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [location.pathname, scrollRef]);

  return (
    <motion.div
      key={location.pathname}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="min-h-full"
    >
      <Outlet />
    </motion.div>
  );
}

const COLLAPSED_KEY = "beacon.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export function DashboardLayout() {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggleCollapsed = () =>
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1");
      } catch {
        /* the choice just will not survive a reload */
      }
      return !current;
    });
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Read once here, so the desktop sidebar and the mobile drawer share it.
  const alerts = useAlertSummary();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="flex h-full bg-background">
      <aside
        className={cn(
          "hidden shrink-0 overflow-hidden border-r border-border/60 bg-surface/40 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] transition-[width] duration-200 lg:block",
          // The same padding in both widths keeps every icon at the same spot.
          "pl-[calc(0.75rem+env(safe-area-inset-left))] pr-3",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <SidebarContent
          scope="desktop"
          alerts={alerts}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {/*
       * The container is always mounted and stops taking pointer events the
       * instant the drawer is asked to close, rather than when its exit
       * animation finishes. An animation that never completes then leaves at
       * worst something invisible on screen, instead of a full-screen layer
       * that swallows every tap until the page is reloaded.
       */}
      <div className={cn("fixed inset-0 z-40 lg:hidden", !open && "pointer-events-none")} aria-hidden={!open}>
        <AnimatePresence>
          {open ? (
            <motion.div
              key="drawer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0"
            >
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
              <motion.aside
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "tween", duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="absolute inset-y-0 left-0 w-64 border-r border-border/60 bg-surface pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-3 pt-[calc(1rem+env(safe-area-inset-top))]"
              >
                <SidebarContent scope="mobile" onNavigate={() => setOpen(false)} alerts={alerts} />
              </motion.aside>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border/60 bg-background/95 pb-3 pl-[calc(1rem+env(safe-area-inset-left))] pr-[calc(1rem+env(safe-area-inset-right))] pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setOpen(true)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
          <span className="text-sm font-semibold">Beacon</span>
        </header>
        <main
          ref={mainRef}
          className="scroll-slim scroll-contain min-h-0 min-w-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        >
          <PageTransition scrollRef={mainRef} />
        </main>
      </div>

      <UpdateNotices />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>
      ) : null}
    </div>
  );
}
