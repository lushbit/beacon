import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

/**
 * Screen capture deliberately uses only what is already on the device:
 * a bundled helper on Windows, the built-in `screencapture` on macOS, and
 * ImageMagick on X11. Where none of that is available the agent says so and
 * the dashboard hides the feature instead of showing a broken tab.
 */

const require = createRequire(import.meta.url);

type ScreenshotFn = (options?: { format?: string; screen?: number }) => Promise<Buffer>;

interface JimpImage {
  bitmap: { width: number; height: number };
  resize(options: { w: number }): JimpImage;
  getBuffer(mime: string, options?: { quality?: number }): Promise<Buffer>;
}

interface JimpModule {
  Jimp: { read(input: Buffer): Promise<JimpImage> };
}

let screenshotFn: ScreenshotFn | null = null;
let jimp: JimpModule | null = null;

function loadScreenshot(): ScreenshotFn {
  if (!screenshotFn) {
    const loaded = require("screenshot-desktop") as ScreenshotFn | { default: ScreenshotFn };
    screenshotFn = typeof loaded === "function" ? loaded : loaded.default;
  }
  return screenshotFn;
}

function loadJimp(): JimpModule {
  if (!jimp) jimp = require("jimp") as JimpModule;
  return jimp;
}

function hasBinary(name: string): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface ScreenCapability {
  screen: boolean;
  screenReason: string | null;
}

export function detectScreenCapability(): ScreenCapability {
  if (process.platform === "win32" || process.platform === "darwin") {
    return { screen: true, screenReason: null };
  }
  if (process.platform === "linux") {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      return { screen: false, screenReason: "No graphical session is running on this device." };
    }
    if ((process.env.XDG_SESSION_TYPE ?? "").toLowerCase() === "wayland") {
      return {
        screen: false,
        screenReason: "Wayland sessions cannot be captured without extra software.",
      };
    }
    if (!hasBinary("import")) {
      return {
        screen: false,
        screenReason: "ImageMagick is not installed, which Linux screen capture needs.",
      };
    }
    return { screen: true, screenReason: null };
  }
  return { screen: false, screenReason: `Screen capture is not supported on ${process.platform}.` };
}

export interface Frame {
  data: string;
  width: number;
  height: number;
  format: "jpeg";
}

async function captureFrame(maxWidth: number, quality: number): Promise<Frame> {
  const raw = await loadScreenshot()({ format: "png" });
  const image = await loadJimp().Jimp.read(raw);
  if (image.bitmap.width > maxWidth) image.resize({ w: maxWidth });
  const jpeg = await image.getBuffer("image/jpeg", { quality });
  return {
    data: jpeg.toString("base64"),
    width: image.bitmap.width,
    height: image.bitmap.height,
    format: "jpeg",
  };
}

export interface ScreenStreamOptions {
  fps: number;
  quality: number;
  maxWidth: number;
  onFrame: (frame: Frame) => void;
  onError: (message: string) => void;
}

export class ScreenStream {
  private timer: NodeJS.Timeout | null = null;
  private capturing = false;
  private failures = 0;

  constructor(private readonly options: ScreenStreamOptions) {}

  start(): void {
    if (this.timer) return;
    const intervalMs = Math.max(100, Math.round(1000 / Math.max(1, this.options.fps)));
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  private async tick(): Promise<void> {
    // Skip the tick rather than queue up captures on a slow machine.
    if (this.capturing) return;
    this.capturing = true;
    try {
      const frame = await captureFrame(this.options.maxWidth, this.options.quality);
      this.failures = 0;
      this.options.onFrame(frame);
    } catch (error) {
      this.failures += 1;
      if (this.failures >= 3) {
        const message = error instanceof Error ? error.message : String(error);
        this.stop();
        this.options.onError(message);
      }
    } finally {
      this.capturing = false;
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

/** Verifies capture actually works before the hub promises a stream. */
export async function probeCapture(): Promise<{ ok: boolean; error?: string }> {
  try {
    await captureFrame(320, 40);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
