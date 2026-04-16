FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY packages/ergenekon-collector/package.json ./packages/ergenekon-collector/

# Install deps
RUN npm ci --workspace=packages/ergenekon-core --workspace=packages/ergenekon-collector

# Copy source
COPY packages/ergenekon-core/ ./packages/ergenekon-core/
COPY packages/ergenekon-collector/ ./packages/ergenekon-collector/

# Build
RUN npm run build --workspace=packages/ergenekon-core
RUN npm run build --workspace=packages/ergenekon-collector

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ergenekon-core/dist ./packages/ergenekon-core/dist
COPY --from=builder /app/packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY --from=builder /app/packages/ergenekon-collector/dist ./packages/ergenekon-collector/dist
COPY --from=builder /app/packages/ergenekon-collector/package.json ./packages/ergenekon-collector/
COPY --from=builder /app/package.json ./

RUN mkdir -p /data/sessions

ENV PORT=4380
ENV STORAGE_DIR=/data/sessions
ENV NODE_ENV=production

EXPOSE 4380

CMD ["node", "packages/ergenekon-collector/dist/index.js"]
