import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing");

/*
 * Canvas pages under /p/ are opened by people without an account, often
 * inside another site. They load only what a page needs, never the dashboard,
 * its sign-in check or its live connection.
 */
const isCanvasPage = window.location.pathname.startsWith("/p/");
const Root = isCanvasPage ? lazy(() => import("./canvas/PublicCanvasApp")) : lazy(() => import("./DashboardRoot"));

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>
);
