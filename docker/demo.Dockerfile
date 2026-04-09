FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/paradox-core/package.json ./packages/paradox-core/
COPY packages/paradox-probe/package.json ./packages/paradox-probe/
COPY packages/paradox-collector/package.json ./packages/paradox-collector/
COPY packages/paradox-replay/package.json ./packages/paradox-replay/
COPY packages/paradox-ui/package.json ./packages/paradox-ui/
COPY packages/paradox-cli/package.json ./packages/paradox-cli/

RUN npm ci

COPY packages/ ./packages/

RUN npm run build

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/package.json ./
COPY demo/ ./demo/

ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "--loader", "ts-node/esm", "demo/app.ts"]
