FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/paradox-core/package.json ./packages/paradox-core/
COPY packages/paradox-collector/package.json ./packages/paradox-collector/

# Install deps
RUN npm ci --workspace=packages/paradox-core --workspace=packages/paradox-collector

# Copy source
COPY packages/paradox-core/ ./packages/paradox-core/
COPY packages/paradox-collector/ ./packages/paradox-collector/

# Build
RUN npm run build --workspace=packages/paradox-core
RUN npm run build --workspace=packages/paradox-collector

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/paradox-core/dist ./packages/paradox-core/dist
COPY --from=builder /app/packages/paradox-core/package.json ./packages/paradox-core/
COPY --from=builder /app/packages/paradox-collector/dist ./packages/paradox-collector/dist
COPY --from=builder /app/packages/paradox-collector/package.json ./packages/paradox-collector/
COPY --from=builder /app/package.json ./

RUN mkdir -p /data/sessions

ENV PORT=4380
ENV STORAGE_DIR=/data/sessions
ENV NODE_ENV=production

EXPOSE 4380

CMD ["node", "packages/paradox-collector/dist/index.js"]
