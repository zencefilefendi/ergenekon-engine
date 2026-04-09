FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/paradox-core/package.json ./packages/paradox-core/
COPY packages/paradox-ui/package.json ./packages/paradox-ui/

RUN npm ci --workspace=packages/paradox-core --workspace=packages/paradox-ui

COPY packages/paradox-core/ ./packages/paradox-core/
COPY packages/paradox-ui/ ./packages/paradox-ui/

RUN npm run build --workspace=packages/paradox-core
RUN npm run build --workspace=packages/paradox-ui

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/paradox-core/dist ./packages/paradox-core/dist
COPY --from=builder /app/packages/paradox-core/package.json ./packages/paradox-core/
COPY --from=builder /app/packages/paradox-ui/dist ./packages/paradox-ui/dist
COPY --from=builder /app/packages/paradox-ui/package.json ./packages/paradox-ui/
COPY --from=builder /app/package.json ./

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "packages/paradox-ui/dist/index.js"]
