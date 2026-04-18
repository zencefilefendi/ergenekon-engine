FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
COPY license-server/package.json ./license-server/
# SECURITY (MED-17): --ignore-scripts prevents postinstall supply-chain attacks
RUN npm install --workspace=license-server --production --ignore-scripts 2>/dev/null || npm install --ignore-scripts

# Copy source
COPY license-server/ ./license-server/

# Use non-root user
RUN addgroup -g 1001 -S ergenekon && \
    adduser -S ergenekon -u 1001
USER ergenekon

EXPOSE 4400

ENV NODE_ENV=production
ENV LICENSE_SERVER_PORT=4400

CMD ["npx", "tsx", "license-server/src/index.ts"]
