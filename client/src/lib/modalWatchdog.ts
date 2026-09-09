/**
 * Recovers the page when a modal layer leaves the document in a locked state.
 *
 * Radix sets inline styles on <body> while a dialog, select or menu is open:
 * `pointer-events: none` so the background cannot be clicked, and
 * `overflow: hidden` (plus scrollbar compensation) so it cannot be scrolled.
 * Those are removed when the layer closes — unless the layer is unmounted while
 * still open, which happens on a route change or a re-render that drops it. The
 * styles are then left behind and the page stops responding to taps and swipes
 * until it is reloaded.
 *
 * This watches for that state and clears it, but only once nothing is actually
 * open and the condition has persisted across two checks, so it never fights a
 * closing animation.
 */

const OPEN_LAYER_SELECTOR = [
  '[data-radix-popper-content-wrapper]',
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(", ");

const LOCKED_STYLES = ["pointer-events", "overflow", "padding-right"] as const;

function hasOpenLayer(): boolean {
  return document.querySelector(OPEN_LAYER_SELECTOR) !== null;
}

function isLocked(body: HTMLElement): boolean {
  return body.style.pointerEvents === "none" || body.style.overflow === "hidden";
}

export function startModalWatchdog(): () => void {
  const body = document.body;
  let strikes = 0;

  const check = () => {
    if (!isLocked(body) || hasOpenLayer()) {
      strikes = 0;
      return;
    }

    // Give a closing animation one cycle to finish before intervening.
    strikes += 1;
    if (strikes < 2) return;
    strikes = 0;

    for (const property of LOCKED_STYLES) body.style.removeProperty(property);
    if (import.meta.env.DEV) {
      console.warn("[beacon] cleared a stuck modal lock on <body>");
    }
  };

  const timer = window.setInterval(check, 500);
  return () => window.clearInterval(timer);
}
