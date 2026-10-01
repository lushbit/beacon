/**
 * The content security policy every response carries. Only `frame-ancestors`
 * ever changes: Canvas pages an admin allows on other sites relax it for that
 * page alone, and everything else refuses to be framed at all.
 */
export function contentSecurityPolicy(frameAncestors = "'none'"): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    `frame-ancestors ${frameAncestors}`,
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    // Allow inline data/blob images (generated avatars, chart exports).
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "form-action 'self'",
  ].join("; ");
}
