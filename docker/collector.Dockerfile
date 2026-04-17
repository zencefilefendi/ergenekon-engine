FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY packages/ergenekon-collector/package.json ./packages/ergenekon-collector/

# SECURITY (MED-17): --ignore-scripts prevents postinstall supply-chain attacks
RUN npm ci --workspace=packages/ergenekon-core --workspace=packages/ergenekon-collector --ignore-scripts

# Copy source
COPY packages/ergenekon-core/ ./packages/ergenekon-core/
COPY packages/ergenekon-collector/ ./packages/ergenekon-collector/

# Build
RUN npm run build --workspace=packages/ergenekon-core
RUN npm run build --workspace=packages/ergenekon-collector

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# SECURITY (MED-01): Run as non-root user
RUN addgroup -g 1001 -S ergenekon && \
    adduser -u 1001 -S ergenekon -G ergenekon

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ergenekon-core/dist ./packages/ergenekon-core/dist
COPY --from=builder /app/packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY --from=builder /app/packages/ergenekon-collector/dist ./packages/ergenekon-collector/dist
COPY --from=builder /app/packages/ergenekon-collector/package.json ./packages/ergenekon-collector/
COPY --from=builder /app/package.json ./

RUN mkdir -p /data/sessions && chown -R ergenekon:ergenekon /data/sessions

ENV PORT=4380
ENV STORAGE_DIR=/data/sessions
ENV NODE_ENV=production

# SECURITY: Drop to non-root
USER ergenekon

EXPOSE 4380

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:4380/api/v1/stats || exit 1

CMD ["node", "packages/ergenekon-collector/dist/index.js"]
