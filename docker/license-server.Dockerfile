FROM node:26-alpine AS base
WORKDIR /app

# Install all dependencies for build
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
COPY license-server/package.json ./license-server/
RUN npm ci --ignore-scripts

# Copy source and build
COPY packages/ergenekon-core/ ./packages/ergenekon-core/
COPY license-server/ ./license-server/
RUN npm run build --workspace=packages/ergenekon-core
RUN npm run build --workspace=license-server || (cd license-server && npx tsc)

# Production stage
FROM node:26-alpine AS production
WORKDIR /app

COPY package.json package-lock.json ./
COPY license-server/package.json ./license-server/
COPY packages/ergenekon-core/package.json ./packages/ergenekon-core/
RUN npm ci --omit=dev --ignore-scripts

COPY --from=base /app/packages/ergenekon-core/dist ./packages/ergenekon-core/dist
COPY --from=base /app/license-server/dist ./license-server/dist

# Use non-root user
RUN addgroup -g 1001 -S ergenekon && \
    adduser -S ergenekon -u 1001
USER ergenekon

EXPOSE 4400

ENV NODE_ENV=production
ENV LICENSE_SERVER_PORT=4400

CMD ["node", "license-server/dist/index.js"]
