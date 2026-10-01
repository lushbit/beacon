/**
 * A small two-part badge, label on the left and value on the right, in the
 * style README files already use for build status. Drawn here so it needs no
 * service outside the hub.
 */

const COLORS = {
  ok: "#2f9e6e",
  warning: "#c98500",
  critical: "#d1434b",
  neutral: "#555555",
  muted: "#8a8a8a",
} as const;

export type BadgeTone = keyof typeof COLORS;

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Close enough to Verdana at 11px for the boxes to fit their text. */
function textWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    if ("ilI.,:;!|' ".includes(char)) width += 3.6;
    else if ("mwMW%@".includes(char)) width += 9.6;
    else if (/[A-Z0-9]/.test(char)) width += 7.4;
    else width += 6.4;
  }
  return Math.round(width);
}

export function badgeSvg(label: string, value: string, tone: BadgeTone): string {
  const left = textWidth(label) + 12;
  const right = textWidth(value) + 12;
  const total = left + right;
  const safeLabel = escape(label);
  const safeValue = escape(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${safeLabel}: ${safeValue}">
<title>${safeLabel}: ${safeValue}</title>
<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
<clipPath id="r"><rect width="${total}" height="20" rx="3" fill="#fff"/></clipPath>
<g clip-path="url(#r)">
<rect width="${left}" height="20" fill="#2b2b2b"/>
<rect x="${left}" width="${right}" height="20" fill="${COLORS[tone]}"/>
<rect width="${total}" height="20" fill="url(#s)"/>
</g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
<text x="${left / 2}" y="15" fill="#010101" fill-opacity=".3">${safeLabel}</text>
<text x="${left / 2}" y="14">${safeLabel}</text>
<text x="${left + right / 2}" y="15" fill="#010101" fill-opacity=".3">${safeValue}</text>
<text x="${left + right / 2}" y="14">${safeValue}</text>
</g>
</svg>`;
}
