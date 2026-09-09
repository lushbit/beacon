/**
 * Copying text from any hub address, secure context or not.
 *
 * `navigator.clipboard` exists on HTTPS and on localhost only, so a hub reached
 * at `http://nas.local:4800` has to fall back to `execCommand("copy")`. That
 * fallback is easy to get wrong: it copies the document selection, and a scratch
 * element appended to `document.body` sits outside the dialog, where the modal's
 * focus trap takes the selection straight back. `execCommand` then reports
 * success while the clipboard stays empty, which is exactly what a phone showed.
 *
 * So the fallback selects the element the command is already displayed in, and
 * only claims success when the selection really holds the command. When it
 * cannot, the text stays selected and the caller says so instead of pretending.
 */
export type CopyResult = "copied" | "manual";

export async function copyText(text: string, source?: HTMLElement | null): Promise<CopyResult> {
  // The permission can still be refused, so this is a try rather than a check.
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return "copied";
    } catch {
      /* fall through to the selection-based copy */
    }
  }

  // Everything below has to stay synchronous. The browser only allows a copy
  // while it is still handling the click that asked for one.
  if (copyBySelectingElement(text, source)) return "copied";
  if (copyByScratchElement(text, source)) return "copied";

  // Leave the command selected so a tap on the browser's own copy finishes it.
  selectContents(source);
  return "manual";
}

function selectContents(element?: HTMLElement | null): boolean {
  const selection = document.getSelection();
  if (!element || !selection) return false;
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

/** Reads back what is actually selected, which is the only honest check available. */
function selectionHolds(text: string): boolean {
  return (document.getSelection()?.toString() ?? "").trim() === text.trim();
}

/**
 * The element is already inside the dialog, so no focus trap can move the
 * selection out from under the copy.
 */
function copyBySelectingElement(text: string, source?: HTMLElement | null): boolean {
  if (!selectContents(source)) return false;
  try {
    if (!document.execCommand("copy") || !selectionHolds(text)) return false;
  } catch {
    return false;
  }
  document.getSelection()?.removeAllRanges();
  return true;
}

/** For callers with nothing on screen to select, such as a plain value. */
function copyByScratchElement(text: string, source?: HTMLElement | null): boolean {
  // Staying inside the dialog matters for the same reason as above.
  const container = source?.parentElement ?? document.body;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // 12pt keeps iOS from zooming, and following the scroll position keeps the
  // page from jumping when the element takes focus.
  area.style.cssText = "position:absolute;left:-9999px;font-size:12pt;border:0;padding:0;margin:0;";
  area.style.top = `${window.scrollY}px`;
  container.appendChild(area);

  try {
    area.focus();
    area.select();
    area.setSelectionRange(0, text.length);
    // A textarea selection is not part of the document selection, so it cannot
    // be read back. Confirming the element still holds focus and the whole
    // value is selected catches the case that produced the false success.
    const ready = document.activeElement === area && area.selectionEnd - area.selectionStart === text.length;
    return ready && document.execCommand("copy");
  } catch {
    return false;
  } finally {
    container.removeChild(area);
  }
}
