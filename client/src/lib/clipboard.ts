/**
 * Copying text without a secure context.
 *
 * `navigator.clipboard` exists on HTTPS and on localhost only. A hub reached at
 * `http://nas.local:4800` is not a secure context, so the modern API is missing
 * entirely and the copy buttons could do nothing at all. The old
 * `execCommand("copy")` still works there, so it is the fallback.
 *
 * Pass `source` (the element showing the text) when there is one. Copying a
 * selection made inside the dialog is the one path that cannot be spoiled by a
 * focus trap moving focus back out of a scratch element.
 */
export async function copyText(text: string, source?: HTMLElement | null): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* denied or unavailable, so fall through */
    }
  }
  return copyFromScratchElement(text) || copyFromSource(source);
}

function withSelection(run: () => boolean): boolean {
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  try {
    return run();
  } catch {
    return false;
  } finally {
    if (selection) {
      selection.removeAllRanges();
      if (previous) selection.addRange(previous);
    }
  }
}

function copyFromScratchElement(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  // Off-screen, but still part of the layout so the selection is real.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  try {
    return withSelection(() => {
      area.select();
      area.setSelectionRange(0, text.length);
      return document.execCommand("copy");
    });
  } finally {
    document.body.removeChild(area);
  }
}

function copyFromSource(source?: HTMLElement | null): boolean {
  if (!source) return false;
  return withSelection(() => {
    const selection = document.getSelection();
    if (!selection) return false;
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
    return document.execCommand("copy");
  });
}
