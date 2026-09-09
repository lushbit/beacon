export interface Point {
  ts: number;
  [key: string]: number | null;
}

export interface Scale {
  (value: number): number;
}

export function linearScale(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return (value: number) => r0 + ((value - d0) / span) * (r1 - r0);
}

/**
 * The axis stops exactly at the tallest value in the window, so a series that
 * never leaves single digits still fills the chart instead of hugging the
 * baseline of a 0–100 scale. `clamp` is the ceiling a scale may never exceed —
 * 100 for percentages — and `floor` keeps a flat, all-zero series from being
 * magnified into noise.
 */
export function peakOf(points: Point[], keys: string[], options: { clamp?: number; floor?: number } = {}): number {
  let peak = 0;
  for (const point of points) {
    for (const key of keys) {
      const value = point[key];
      if (typeof value === "number" && Number.isFinite(value)) peak = Math.max(peak, value);
    }
  }
  if (options.clamp !== undefined) peak = Math.min(peak, options.clamp);
  return Math.max(peak, options.floor ?? 0) || 1;
}

/** Evenly spaced from zero to the peak; the top label is the peak itself. */
export function valueTicks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, index) => (max * index) / count);
}

/**
 * Candidate spacings for the time axis, from a second to a month. The chart
 * picks the smallest one that still leaves the labels room to breathe, so the
 * axis reads 09:15 · 09:30 · 09:45 on a short window and Mar 3 · Mar 10 on a
 * long one, rather than dividing whatever range it was handed into quarters.
 */
const TIME_STEPS = [
  1_000,
  5_000,
  10_000,
  15_000,
  30_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
  30 * 60_000,
  3_600_000,
  2 * 3_600_000,
  3 * 3_600_000,
  6 * 3_600_000,
  12 * 3_600_000,
  86_400_000,
  2 * 86_400_000,
  7 * 86_400_000,
  14 * 86_400_000,
  30 * 86_400_000,
];

/** Rounds up to the next boundary in local time, so ticks land on the clock. */
function alignUp(ts: number, step: number): number {
  const offset = new Date(ts).getTimezoneOffset() * 60_000;
  return Math.ceil((ts - offset) / step) * step + offset;
}

function tickLabel(ts: number, step: number): string {
  const date = new Date(ts);
  if (step >= 86_400_000) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (step < 60_000) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Time axis ticks for a window, spaced to fit the width they are drawn in. */
export function timeAxisTicks(from: number, to: number, width: number): { ts: number; label: string }[] {
  const span = Math.max(1, to - from);
  const room = Math.max(2, Math.min(8, Math.floor(width / 82)));
  const step = TIME_STEPS.find((candidate) => span / candidate <= room) ?? span / room;

  const ticks: { ts: number; label: string }[] = [];
  for (let ts = alignUp(from, step); ts <= to; ts += step) {
    ticks.push({ ts, label: tickLabel(ts, step) });
  }
  // A window shorter than the smallest sensible step still needs its ends named.
  if (ticks.length === 0) {
    return [
      { ts: from, label: tickLabel(from, step) },
      { ts: to, label: tickLabel(to, step) },
    ];
  }
  return ticks;
}

interface Vertex {
  x: number;
  y: number;
}

/** Median gap between samples, used to tell a real outage from normal spacing. */
function medianStep(points: Point[]): number {
  if (points.length < 3) return 0;
  const steps: number[] = [];
  for (let index = 1; index < points.length; index++) steps.push(points[index].ts - points[index - 1].ts);
  steps.sort((a, b) => a - b);
  return steps[steps.length >> 1];
}

/**
 * Rounds a bucket length up to something a person would name — 10s, 1m, 5m, 1h.
 *
 * The bucket must not depend on how many samples happen to be loaded. Deriving
 * it from the array length means one arriving sample can tip 8-sample buckets
 * into 9-sample ones, which redraws every vertex at once and reads as the whole
 * curve twitching. Anchored to the clock instead, a new sample only ever
 * changes the newest bucket.
 */
export function bucketFor(spanMs: number, target: number): number {
  const wanted = Math.max(1000, spanMs / Math.max(2, target));
  return TIME_STEPS.find((step) => step >= wanted) ?? wanted;
}

/**
 * Averages the series into fixed buckets of wall-clock time.
 *
 * At a five second sample interval an hour of history is 720 readings, which is
 * more than one per pixel on a phone: drawn faithfully, the line renders its own
 * noise as a hairy band. Every dashboard that looks calm is showing means over a
 * bucket rather than raw readings, so this does the same. A short spike is
 * therefore reported at its bucket's average rather than its instantaneous
 * height — the chart shows the shape of the load, and the exact reading is a
 * hover away.
 *
 * Buckets are aligned to absolute time, so the same reading always lands in the
 * same bucket no matter what else is loaded, and a series that is already
 * coarser than the bucket passes through untouched.
 *
 * Runs separated by an outage stay separated: a gap wider than a few sample
 * intervals is carried through as an empty point so the line breaks there
 * instead of striding across missing time.
 */
export function aggregate(points: Point[], keys: string[], bucketMs: number): Point[] {
  if (points.length < 3 || bucketMs <= 0) return points;

  const step = medianStep(points);
  // Forgiving enough that one dropped sample is not an outage, strict enough
  // that a genuine silence still breaks the line.
  const gapAfter = step > 0 ? Math.max(step * 3, bucketMs * 1.5) : Infinity;

  const output: Point[] = [];
  let bucket: Point[] = [];
  let bucketIndex = Number.NaN;

  const flush = () => {
    if (bucket.length === 0) return;
    let ts = 0;
    for (const point of bucket) ts += point.ts;
    const merged: Point = { ts: Math.round(ts / bucket.length) };
    for (const key of keys) {
      let sum = 0;
      let count = 0;
      for (const point of bucket) {
        const value = point[key];
        if (typeof value === "number" && Number.isFinite(value)) {
          sum += value;
          count += 1;
        }
      }
      merged[key] = count > 0 ? sum / count : null;
    }
    output.push(merged);
    bucket = [];
  };

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const slot = Math.floor(point.ts / bucketMs);
    if (bucket.length > 0 && slot !== bucketIndex) flush();
    bucketIndex = slot;
    bucket.push(point);

    const next = points[index + 1];
    if (next !== undefined && next.ts - point.ts > gapAfter) {
      flush();
      // An empty point is how a break is spelled; linePaths starts a new run.
      output.push({ ts: point.ts + Math.round((next.ts - point.ts) / 2) });
    }
  }
  flush();

  return output;
}

/**
 * A monotone cubic spline through the points. Straight segments between every
 * sample are what make a busy series look jagged; a curve reads the way the
 * eye expects a measurement over time to. Monotone rather than plain Catmull-
 * Rom because the latter overshoots around a spike, and a CPU line that dips
 * below zero on its way up is a lie.
 */
function curveThrough(vertices: Vertex[]): string {
  if (vertices.length < 2) return "";
  if (vertices.length === 2) {
    return `M${vertices[0].x} ${vertices[0].y} L${vertices[1].x} ${vertices[1].y}`;
  }

  const count = vertices.length;
  const slopes: number[] = [];
  for (let index = 0; index < count - 1; index++) {
    const dx = vertices[index + 1].x - vertices[index].x;
    slopes.push(dx === 0 ? 0 : (vertices[index + 1].y - vertices[index].y) / dx);
  }

  const tangents: number[] = new Array(count);
  tangents[0] = slopes[0];
  tangents[count - 1] = slopes[count - 2];
  for (let index = 1; index < count - 1; index++) {
    tangents[index] =
      slopes[index - 1] * slopes[index] <= 0 ? 0 : (slopes[index - 1] + slopes[index]) / 2;
  }

  // Fritsch–Carlson: hold the tangents inside the range that keeps each span
  // monotone, which is what stops the curve bulging past its own data.
  for (let index = 0; index < count - 1; index++) {
    if (slopes[index] === 0) {
      tangents[index] = 0;
      tangents[index + 1] = 0;
      continue;
    }
    const a = tangents[index] / slopes[index];
    const b = tangents[index + 1] / slopes[index];
    const size = a * a + b * b;
    if (size > 9) {
      const scale = 3 / Math.sqrt(size);
      tangents[index] = scale * a * slopes[index];
      tangents[index + 1] = scale * b * slopes[index];
    }
  }

  let path = `M${vertices[0].x} ${vertices[0].y}`;
  for (let index = 0; index < count - 1; index++) {
    const from = vertices[index];
    const to = vertices[index + 1];
    const third = (to.x - from.x) / 3;
    path += ` C${from.x + third} ${from.y + tangents[index] * third} ${to.x - third} ${
      to.y - tangents[index + 1] * third
    } ${to.x} ${to.y}`;
  }
  return path;
}

/**
 * Builds one path per unbroken run of values, so a gap in the data reads as a
 * gap rather than a straight line across missing time.
 */
export function linePaths(
  points: Point[],
  key: string,
  x: Scale,
  y: Scale
): { line: string; area: string; last: { x: number; y: number } | null }[] {
  const segments: { line: string; area: string; last: { x: number; y: number } | null }[] = [];
  let current: Vertex[] = [];

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0];
    const last = current[current.length - 1];
    const baseline = y(0);

    const line = current.length > 1 ? curveThrough(current) : `M${first.x} ${first.y}`;

    const area =
      current.length > 1
        ? `${line} L${last.x} ${baseline} L${first.x} ${baseline} Z`
        : `M${first.x - 0.5} ${first.y} L${first.x + 0.5} ${first.y} L${first.x + 0.5} ${baseline} L${first.x - 0.5} ${baseline} Z`;

    segments.push({ line, area, last });
    current = [];
  };

  for (const point of points) {
    const raw = point[key];
    if (raw === null || raw === undefined || !Number.isFinite(raw)) {
      flush();
      continue;
    }
    current.push({ x: x(point.ts), y: y(raw) });
  }
  flush();
  return segments;
}

export function nearestIndex(points: Point[], ts: number): number {
  if (points.length === 0) return -1;
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (points[middle].ts > ts) high = middle;
    else low = middle;
  }
  return Math.abs(points[low].ts - ts) <= Math.abs(points[high].ts - ts) ? low : high;
}
