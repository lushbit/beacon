export interface RangeOption {
  id: string;
  label: string;
  seconds: number;
}

export const RANGES: RangeOption[] = [
  { id: "15m", label: "15m", seconds: 900 },
  { id: "1h", label: "1h", seconds: 3600 },
  { id: "6h", label: "6h", seconds: 21_600 },
  { id: "24h", label: "24h", seconds: 86_400 },
  { id: "7d", label: "7d", seconds: 604_800 },
  { id: "30d", label: "30d", seconds: 2_592_000 },
];

/** Live updates only make sense while the window is short enough to see them. */
export function isLiveRange(seconds: number): boolean {
  return seconds <= 3600;
}
