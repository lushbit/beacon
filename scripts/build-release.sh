#!/bin/sh
# Builds everything and assembles a self-contained release tree in release/.
#
#   ./scripts/build-release.sh
#
# Output:
#   release/                     ready to run with `node server/dist/index.js`
#   release/public/install.sh    agent installer served by the hub
#   release/public/install.ps1   agent installer served by the hub
#   release/public/agent-bundle.tar.gz
#   release/public/beacon-agent-docker.tar.gz  Docker build context
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="$ROOT/release"
WORK="$ROOT/.release-work"

echo "==> Checking version consistency"
node scripts/check-version.mjs

echo "==> Building workspaces"
npm run build

echo "==> Checking build output"
test -f shared/dist/index.js
test -f server/dist/index.js
test -f client/dist/index.html
test -f agent/dist/index.js
head -1 agent/dist/index.js | grep -qx '#!/usr/bin/env node'

rm -rf "$OUT" "$WORK"
mkdir -p "$OUT" "$WORK"

echo "==> Assembling the agent bundle"
# Production dependencies for the agent only; the dashboard never ships to a
# monitored device.
mkdir -p "$WORK/shared" "$WORK/agent"
cp shared/package.json "$WORK/shared/package.json"
cp agent/package.json "$WORK/agent/package.json"
cat > "$WORK/package.json" <<'JSON'
{
  "name": "beacon-agent-bundle",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "agent"]
}
JSON

(cd "$WORK" && npm install --omit=dev --no-audit --no-fund)

cp -r shared/dist "$WORK/shared/dist"
cp -r agent/dist "$WORK/agent/dist"
# The launcher ships inside the bundle so an update can refresh it too.
cp scripts/launcher.mjs "$WORK/launcher.mjs"

# Nothing in the bundle may be a symlink. Windows refuses to create one unless
# the shell is elevated or developer mode is on, and tar abandons the whole
# extraction the moment it hits the first, which is what made a non-elevated
# PowerShell install fail. The workspace links become real directories; the
# .bin shims are command-line helpers the agent never uses, so they just go.
rm -rf "$WORK/node_modules/@beacon/shared"
cp -r "$WORK/shared" "$WORK/node_modules/@beacon/shared"
rm -rf "$WORK/node_modules/@beacon/agent"
rm -rf "$WORK/node_modules/.bin"
find "$WORK/node_modules" -type l -delete

mkdir -p "$OUT/public"
tar -czf "$OUT/public/agent-bundle.tar.gz" -C "$WORK" agent node_modules package.json launcher.mjs
cp scripts/install-agent.sh "$OUT/public/install.sh"
cp scripts/install-agent.ps1 "$OUT/public/install.ps1"

echo "==> Assembling the Docker build context"
# A tarball Docker can build straight from a URL:
#
#   docker build -t beacon-agent https://your-hub/download/beacon-agent-docker.tar.gz
#
# No git on the host, no access to the source repository and no build toolchain
# in the image — the agent inside is the same prebuilt bundle every other
# install method gets.
cat > "$WORK/Dockerfile" <<'DOCKER'
FROM node:20-slim
ENV NODE_ENV=production
# The device token is written here, so keep it on a volume to stay enrolled
# across container replacements.
ENV BEACON_CONFIG=/data/agent.json
WORKDIR /app
COPY package.json ./package.json
COPY agent ./agent
COPY node_modules ./node_modules
VOLUME ["/data"]
ENTRYPOINT ["node", "agent/dist/index.js"]
DOCKER
tar -czf "$OUT/public/beacon-agent-docker.tar.gz" -C "$WORK" Dockerfile package.json agent node_modules

echo "==> Writing the release manifest"
node scripts/write-manifest.mjs

echo "==> Verifying the agent bundle runs on its own"
VERIFY="$WORK/verify"
mkdir -p "$VERIFY"
tar -xzf "$OUT/public/agent-bundle.tar.gz" -C "$VERIFY"
test ! -L "$VERIFY/node_modules/@beacon/shared"
test -f "$VERIFY/launcher.mjs"
node "$VERIFY/agent/dist/index.js" --version > /dev/null

# A single symlink anywhere in the archive breaks the Windows installer, so the
# archive itself is checked rather than trusting the steps above.
if tar -tvzf "$OUT/public/agent-bundle.tar.gz" | grep -q "^l"; then
  echo "the agent bundle contains a symlink, which Windows cannot extract" >&2
  exit 1
fi
if tar -tvzf "$OUT/public/beacon-agent-docker.tar.gz" | grep -q "^l"; then
  echo "the Docker build context contains a symlink" >&2
  exit 1
fi

echo "==> Assembling the hub"
mkdir -p "$OUT/shared" "$OUT/server" "$OUT/client"
cp -r shared/dist "$OUT/shared/dist"
cp -r server/dist "$OUT/server/dist"
cp -r client/dist "$OUT/client/dist"
cp shared/package.json "$OUT/shared/package.json"
cp server/package.json "$OUT/server/package.json"
cat > "$OUT/package.json" <<'JSON'
{
  "name": "beacon-runtime",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server"],
  "scripts": { "start": "node server/dist/index.js" }
}
JSON

(cd "$OUT" && npm install --omit=dev --no-audit --no-fund)

rm -rf "$WORK"

echo
echo "Release ready in release/"
du -sh "$OUT" "$OUT/public/agent-bundle.tar.gz" 2>/dev/null || true
