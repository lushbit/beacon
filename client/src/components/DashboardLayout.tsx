import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpCircle, Bell, ExternalLink, Gauge, LogOut, Menu, RadioTower, RotateCw, Settings2, Tag, Users as UsersIcon, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useVersion } from "@/context/VersionContext";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

const NAVIGATE: NavItem[] = [
  { to: "/", label: "Overview", icon: Gauge },
  { to: "/alerts", label: "Alerts", icon: Bell },
];

const MANAGE: NavItem[] = [
  { to: "/users", label: "Users", icon: UsersIcon, adminOnly: true },
  { to: "/settings", label: "Settings", icon: Settings2 },
];

function SidebarLink({ item, onNavigate, scope }: { item: NavItem; onNavigate?: () => void; scope: string }) {
  const Icon = item.icon;
  return (
    <NavLink to={item.to} end={item.to === "/"} onClick={onNavigate}>
      {({ isActive }) => (
        <span
          className={cn(
            "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors duration-200",
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
          <span className="relative truncate">{item.label}</span>
        </span>
      )}
    </NavLink>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-3 pb-2 pt-5 text-2xs font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">{children}</p>;
}

/**
 * `scope` keeps the active pill's `layoutId` unique per instance. The desktop
 * sidebar stays mounted at every width (it is only hidden with `lg:block`), so
 * opening the mobile drawer puts a second copy of every link in the tree. Two
 * elements sharing one `layoutId` make framer-motion animate between them, and
 * the hidden copy measures zero, which wedges the projection and can leave the
 * drawer's exit animation unfinished.
 */
function SidebarContent({ onNavigate, scope }: { onNavigate?: () => void; scope: string }) {
  const { session, signOut, siteName } = useAuth();
  const { info, appVersion, needsReload } = useVersion();
  const isAdmin = session?.user.role === "admin";
  const version = info?.current ?? appVersion;
  const sourceUrl = info?.sourceUrl ?? null;

  return (
    <div className="flex h-full flex-col">
      <Link to="/" onClick={onNavigate} className="flex items-center gap-2.5 px-3 pb-2 pt-1">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-inset ring-white/10">
          <RadioTower className="h-4 w-4 text-foreground" />
        </span>
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">{siteName}</span>
      </Link>

      <nav className="flex-1 overflow-y-auto scroll-slim">
        <SectionLabel>Navigate</SectionLabel>
        <div className="space-y-1">
          {NAVIGATE.map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} scope={scope} />
          ))}
        </div>

        <SectionLabel>Manage</SectionLabel>
        <div className="space-y-1">
          {MANAGE.filter((item) => !item.adminOnly || isAdmin).map((item) => (
            <SidebarLink key={item.to} item={item} onNavigate={onNavigate} scope={scope} />
          ))}
        </div>
      </nav>

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

export function DashboardLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);

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
      <aside className="hidden w-60 shrink-0 border-r border-border/60 bg-surface/40 pb-[calc(1rem+env(safe-area-inset-bottom))] pl-[calc(0.75rem+env(safe-area-inset-left))] pr-3 pt-[calc(1rem+env(safe-area-inset-top))] lg:block">
        <SidebarContent scope="desktop" />
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
                <SidebarContent scope="mobile" onNavigate={() => setOpen(false)} />
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
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
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
