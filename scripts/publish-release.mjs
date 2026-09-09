#!/usr/bin/env node
/**
 * Publishes a release from a tag build: creates the GitHub release from the
 * matching CHANGELOG section and attaches the agent bundle and manifest, which
 * is what the hub's update check reads.
 *
 * Environment: GITHUB_TOKEN, GITHUB_REPO (owner/name), RELEASE_TAG.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPO;
const tag = process.env.RELEASE_TAG;

if (!token || !repo || !tag) {
  console.error("GITHUB_TOKEN, GITHUB_REPO and RELEASE_TAG are all required");
  process.exit(1);
}

const version = tag.replace(/^v/i, "");
const declared = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (declared !== version) {
  console.error(`tag ${tag} does not match the version in the source (${declared})`);
  process.exit(1);
}

/**
 * The section of CHANGELOG.md for this version, used as the release notes.
 *
 * Read line by line rather than with one regular expression: the previous
 * pattern ended at `(?=\n## |$)` under the `m` flag, where `$` matches the end
 * of every line, so it stopped on the heading's own newline and published an
 * empty release body.
 */
function releaseNotes() {
  const file = join(root, "CHANGELOG.md");
  if (!existsSync(file)) return `Release ${version}`;

  const lines = readFileSync(file, "utf8").split("\n");
  const heading = /^## \[?([^\]\s]+)\]?/;
  const start = lines.findIndex((line) => heading.exec(line)?.[1] === version);
  if (start === -1) return `Release ${version}`;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  const notes = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return notes || `Release ${version}`;
}

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "beacon-release",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
};

const release = await api(`/repos/${repo}/releases`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    tag_name: tag,
    name: `Beacon ${version}`,
    body: releaseNotes(),
    draft: false,
    prerelease: version.includes("-"),
  }),
});

console.log(`created release ${release.html_url}`);

const publicDir = join(root, "release", "public");
for (const asset of [`agent-${version}.tar.gz`, "manifest.json"]) {
  const file = join(publicDir, asset);
  if (!existsSync(file)) {
    console.error(`missing release asset: ${asset}`);
    process.exit(1);
  }
  const body = readFileSync(file);
  const upload = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": "beacon-release",
        "Content-Type": "application/octet-stream",
        "Content-Length": String(body.length),
      },
      body,
    }
  );
  if (!upload.ok) {
    console.error(`upload of ${asset} failed: ${upload.status} ${(await upload.text()).slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`uploaded ${asset}`);
}
