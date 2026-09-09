import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { output, ZodTypeAny } from "zod";

/** Express 4 does not forward rejected promises, so every async route uses this. */
export function handler(fn: (req: Request, res: Response) => Promise<void> | void): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/** Returns the parsed *output* type, so zod defaults arrive already filled in. */
export function parseBody<S extends ZodTypeAny>(schema: S, req: Request, res: Response): output<S> | null {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    const first = result.error.issues[0];
    res.status(400).json({
      error: first ? `${first.path.join(".") || "request"}: ${first.message}` : "Invalid request.",
    });
    return null;
  }
  return result.data as output<S>;
}

export function notFound(res: Response, what = "Not found."): void {
  res.status(404).json({ error: what });
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  if (!res.headersSent) res.status(500).json({ error: message });
}
