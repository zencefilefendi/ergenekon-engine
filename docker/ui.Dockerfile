FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY packages/ergenekon-ui/package.json ./packages/ergenekon-ui/

# SECURITY (MED-17): --ignore-scripts prevents postinstall supply-chain attacks
RUN npm ci --workspace=packages/ergenekon-core --workspace=packages/ergenekon-ui --ignore-scripts

COPY packages/ergenekon-core/ ./packages/ergenekon-core/
COPY packages/ergenekon-ui/ ./packages/ergenekon-ui/

RUN npm run build --workspace=packages/ergenekon-core
RUN npm run build --workspace=packages/ergenekon-ui

# ─────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/ergenekon-core/dist ./packages/ergenekon-core/dist
COPY --from=builder /app/packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY --from=builder /app/packages/ergenekon-ui/dist ./packages/ergenekon-ui/dist
COPY --from=builder /app/packages/ergenekon-ui/package.json ./packages/ergenekon-ui/
COPY --from=builder /app/package.json ./

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "packages/ergenekon-ui/dist/index.js"]
