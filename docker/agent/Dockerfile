# Beacon agent — build context is the repository root.
#
#   docker build -t beacon-agent -f docker/agent/Dockerfile .
#
FROM node:20-slim AS build
WORKDIR /src

# Only the two workspaces the agent needs; the dashboard never enters the image.
COPY package.json ./
COPY shared/package.json ./shared/
COPY agent/package.json ./agent/
RUN npm install --workspace=shared --workspace=agent --include-workspace-root

COPY shared ./shared
COPY agent ./agent
RUN npm run build --workspace=shared \
 && npm run build --workspace=agent \
 && npm prune --omit=dev

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/package.json ./package.json
COPY --from=build /src/shared/package.json ./shared/package.json
COPY --from=build /src/shared/dist ./shared/dist
COPY --from=build /src/agent/package.json ./agent/package.json
COPY --from=build /src/agent/dist ./agent/dist

# The device token is written here, so keep it on a volume to stay enrolled
# across container replacements.
ENV BEACON_CONFIG=/data/agent.json
VOLUME ["/data"]

ENTRYPOINT ["node", "agent/dist/index.js"]
