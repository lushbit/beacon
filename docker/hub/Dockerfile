# Beacon hub — build context is the repository root.
#
#   docker build -t beacon -f docker/hub/Dockerfile .
#
FROM node:20-slim AS build
WORKDIR /src

COPY package.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
COPY agent/package.json ./agent/
RUN npm install --no-audit --no-fund

COPY . .
RUN sh scripts/build-release.sh

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /src/release ./

ENV PORT=4800
ENV DATABASE_PATH=/data/beacon.db
VOLUME ["/data"]
EXPOSE 4800

# Fails the container health check if the hub stops answering.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4800)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
