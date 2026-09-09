#!/usr/bin/env node
/**
 * Attaches the agent bundle and manifest to a tag's GitHub release, which is
 * what the hub's update check reads.
 *
 * The release itself is the changelog, so its notes are written by hand when
 * cutting the release. This script therefore reuses an existing release for the
 * tag and only creates an empty one when it has to, which lets the notes be
 * written either before or after the build without the step ever failing.
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
  // Deleting an asset answers 204 with no body, which is not parsable JSON.
  return response.status === 204 ? null : response.json();
};

// A release created by hand already holds the notes, so never overwrite it.
const existing = await api(`/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`).catch(() => null);

const release =
  existing ??
  (await api(`/repos/${repo}/releases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tag_name: tag,
      name: `Beacon ${version}`,
      body: "",
      draft: false,
      prerelease: version.includes("-"),
    }),
  }));

console.log(`${existing ? "using existing" : "created"} release ${release.html_url}`);

const publicDir = join(root, "release", "public");
for (const asset of [`agent-${version}.tar.gz`, "manifest.json"]) {
  const file = join(publicDir, asset);
  if (!existsSync(file)) {
    console.error(`missing release asset: ${asset}`);
    process.exit(1);
  }
  const stale = (release.assets ?? []).find((a) => a.name === asset);
  if (stale) {
    await api(`/repos/${repo}/releases/assets/${stale.id}`, { method: "DELETE" });
    console.log(`replaced existing ${asset}`);
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
