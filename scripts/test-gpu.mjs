#!/usr/bin/env node
/**
 * Checks how GPU readings are matched to the adapters on a device.
 *
 * The readings come from up to three sources at once (nvidia-smi, Linux sysfs,
 * the Windows performance counters) and none of them agree on how a card is
 * named, so pairing them is where this goes wrong. The cases below are the ones
 * that have actually bitten: a Windows PC where systeminformation reports no
 * adapter at all, and a machine where two sources describe the same card.
 *
 * Run against a build:  node scripts/test-gpu.mjs
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { merge } = await import(pathToFileURL(join(root, "agent", "dist", "gpu.js")).href);

const failures = [];

function check(condition, description) {
  if (condition) {
    console.log(`  ok    ${description}`);
  } else {
    console.log(`  FAIL  ${description}`);
    failures.push(description);
  }
}

/** The shape every source produces, so a case only spells out what it knows. */
function gpu(fields = {}) {
  return {
    model: "",
    vendor: "",
    utilizationPct: null,
    memoryUsedMb: null,
    memoryTotalMb: null,
    temperatureC: null,
    ...fields,
  };
}

console.log("A Windows PC systeminformation reports no adapter for…");
{
  const result = merge([], [gpu({ model: "NVIDIA GeForce RTX 4070", utilizationPct: 14, memoryUsedMb: 1800 })]);
  check(result.length === 1, "the card the counters found is still reported");
  check(result[0].model === "NVIDIA GeForce RTX 4070", "it keeps the name Windows gave it");
  check(result[0].utilizationPct === 14, "and its load");
}

console.log("\nOne card described by two sources…");
{
  const result = merge(
    [gpu({ vendor: "NVIDIA", model: "GeForce RTX 4070", memoryTotalMb: 4095 })],
    [
      gpu({ vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4070", utilizationPct: 14, memoryUsedMb: 1800, memoryTotalMb: 12282 }),
      gpu({ model: "NVIDIA GeForce RTX 4070", utilizationPct: 12, memoryUsedMb: 1750 }),
    ]
  );
  check(result.length === 1, "there is one GPU rather than a phantom second");
  check(result[0].utilizationPct === 14, "the first source wins the reading");
  check(result[0].memoryTotalMb === 12282, "nvidia-smi's total beats the capped one Windows reports");
}

console.log("\nA chip beside a card…");
{
  const result = merge(
    [gpu({ vendor: "Intel", model: "UHD Graphics 770" }), gpu({ vendor: "NVIDIA", model: "GeForce RTX 4070" })],
    [gpu({ vendor: "NVIDIA", model: "NVIDIA GeForce RTX 4070", utilizationPct: 71 })]
  );
  check(result.length === 2, "both adapters are still listed");
  check(result[0].utilizationPct === null, "the chip is not given the card's load");
  check(result[1].utilizationPct === 71, "the card gets it");
}

console.log("\nA Linux card sysfs can read…");
{
  const result = merge(
    [gpu({ vendor: "AMD", model: "Radeon RX 7800 XT" })],
    [gpu({ vendor: "AMD", utilizationPct: 38, memoryUsedMb: 2048, memoryTotalMb: 16384, temperatureC: 52 })]
  );
  check(result.length === 1, "the reading joins the adapter si named");
  check(result[0].model === "Radeon RX 7800 XT", "the name survives");
  check(result[0].temperatureC === 52, "the temperature comes through");
}

console.log("\nAn adapter nothing can read…");
{
  const result = merge([gpu({ vendor: "Intel", model: "UHD Graphics 770" })], []);
  check(result.length === 1, "is still listed once");
  check(result[0].utilizationPct === null, "with no invented reading");

  const anonymous = merge([gpu({ vendor: "", model: "", memoryTotalMb: 8 })], []);
  check(anonymous.length === 1, "and a nameless one is left as it is");
}

console.log("");
if (failures.length > 0) {
  console.error(`gpu matching FAILED: ${failures.length} check${failures.length === 1 ? "" : "s"}`);
  process.exit(1);
}
console.log("gpu matching ok");
