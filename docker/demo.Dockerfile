FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY packages/ergenekon-probe/package.json ./packages/ergenekon-probe/
COPY packages/ergenekon-collector/package.json ./packages/ergenekon-collector/
COPY packages/ergenekon-replay/package.json ./packages/ergenekon-replay/
COPY packages/ergenekon-ui/package.json ./packages/ergenekon-ui/
COPY packages/ergenekon-cli/package.json ./packages/ergenekon-cli/

# SECURITY (MED-17): --ignore-scripts prevents postinstall supply-chain attacks
RUN npm ci --ignore-scripts

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
