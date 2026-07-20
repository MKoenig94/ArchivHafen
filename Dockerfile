# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY index.html tsconfig.json vite.config.ts vitest.config.ts ./
COPY public ./public
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY src ./src

RUN npm run build \
    && npm prune --omit=dev

FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="Archiv Hafen für Linux" \
      org.opencontainers.image.description="Lokale IMAP-Mailarchivierung mit SQLite und EML-Originalen" \
      org.opencontainers.image.version="0.2.0"

ENV NODE_ENV=production \
    ARCHIVHAFEN_HOST=0.0.0.0 \
    ARCHIVHAFEN_PORT=4174 \
    ARCHIVHAFEN_DATA_DIR=/data \
    ARCHIVHAFEN_SYNC_INTERVAL_MINUTES=15

WORKDIR /app

RUN groupadd --gid 10001 archivhafen \
    && useradd --uid 10001 --gid archivhafen --no-create-home --home-dir /app --shell /usr/sbin/nologin archivhafen \
    && mkdir -p /data \
    && chown archivhafen:archivhafen /data

COPY --from=build --chown=archivhafen:archivhafen /app/package.json /app/package-lock.json ./
COPY --from=build --chown=archivhafen:archivhafen /app/node_modules ./node_modules
COPY --from=build --chown=archivhafen:archivhafen /app/dist ./dist

USER archivhafen
VOLUME ["/data"]
EXPOSE 4174
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4174/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/server/index.js"]
