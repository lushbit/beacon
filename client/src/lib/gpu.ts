import type { GpuUsage } from "@beacon/shared";

/**
 * Makers the vendor and the model both name, spelled differently in each.
 * Windows reports a card as vendor "Advanced Micro Devices, Inc." with model
 * "AMD Radeon RX 7900 XTX", and putting the two together says the maker twice
 * in a line too long for a dropdown to show.
 */
const BRANDS: [RegExp, string][] = [
  [/nvidia|geforce|quadro/i, "nvidia"],
  [/advanced micro devices|\bamd\b|\bati\b|radeon/i, "amd"],
  [/intel|\barc\b/i, "intel"],
  [/apple/i, "apple"],
];

function brandOf(text: string): string {
  return BRANDS.find(([pattern]) => pattern.test(text))?.[1] ?? "";
}

/**
 * What a GPU is called on screen.
 *
 * This is also the key a hidden GPU is stored under in a device's panel
 * settings, so the dashboard and the settings page have to agree on it. Two
 * identical cards in one machine share a name and are therefore hidden
 * together, which is the same trade the volume and interface lists make.
 */
export function gpuName(gpu: GpuUsage, index: number): string {
  const model = gpu.model.trim();
  const vendor = gpu.vendor.trim();
  if (!model) return vendor || `GPU ${index + 1}`;
  if (!vendor) return model;
  const maker = brandOf(vendor);
  return maker && maker === brandOf(model) ? model : `${vendor} ${model}`;
}
