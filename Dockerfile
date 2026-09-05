# Corpus — single-container deployment (spec §2): Next standalone
# output, SQLite file on a volume at /data.
# node:22-slim (glibc) rather than alpine. The builder carries the
# node-gyp toolchain for better-sqlite3's native compile; the runtime
# stage stays slim because the compiled module ships inside the
# standalone output.

FROM node:22-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/adapters/package.json packages/adapters/
COPY packages/cli/package.json packages/cli/
RUN npm ci
COPY . .
RUN npm run build -w apps/web

FROM node:22-slim AS runner
# Build identity (git SHA, and tag if any), shown by /api/health and the
# maintainer corner. Passed by CI; a local build without it reports "dev".
ARG CORPUS_VERSION=dev
ENV CORPUS_VERSION=$CORPUS_VERSION
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV CORPUS_DB_PATH=/data/corpus.db
WORKDIR /app
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
