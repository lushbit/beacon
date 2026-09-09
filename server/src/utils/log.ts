type Level = "debug" | "info" | "warn" | "error";

const levels: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[(process.env.LOG_LEVEL as Level) ?? "info"] ?? levels.info;

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  if (levels[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (extra === undefined) {
    console[level === "debug" ? "log" : level](line);
  } else {
    console[level === "debug" ? "log" : level](line, extra);
  }
}

export function logger(scope: string) {
  return {
    debug: (message: string, extra?: unknown) => emit("debug", scope, message, extra),
    info: (message: string, extra?: unknown) => emit("info", scope, message, extra),
    warn: (message: string, extra?: unknown) => emit("warn", scope, message, extra),
    error: (message: string, extra?: unknown) => emit("error", scope, message, extra),
  };
}
