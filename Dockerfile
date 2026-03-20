# notebook-ai Standalone Dockerfile
# Builds frontend + backend, runs in production mode

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS build

# Install pnpm and build tools
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/shared/package.json packages/shared/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# Build shared types
WORKDIR /app/packages/shared
RUN pnpm run build

# Build frontend (with Chinese as default language)
WORKDIR /app/packages/web
ENV VITE_DEFAULT_LANG=zh
RUN pnpm run build

# Build backend
WORKDIR /app/packages/server
RUN pnpm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y git tini python3 make g++ curl openssl cron && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Copy package files and install production deps
COPY --from=build /app/package.json ./
COPY --from=build /app/pnpm-lock.yaml ./
COPY --from=build /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/server/package.json ./packages/server/
COPY --from=build /app/packages/shared/package.json ./packages/shared/
COPY --from=build /app/packages/web/package.json ./packages/web/

# Install all dependencies (some runtime deps are in devDependencies)
RUN pnpm install --frozen-lockfile

# Copy built artifacts
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/web/dist ./packages/web/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist

# Use existing node user (UID=1000) to match host ubuntu user
# This allows reading mounted .claude credentials without permission changes
RUN usermod -d /home/node -m node 2>/dev/null || true

# Create data directories with proper ownership
RUN mkdir -p /data /home/node/.notebook-ai /home/node/.claude/plugins/cache/moonview \
    && chown -R node:node /data /home/node

# Copy task-ai plugin
COPY --chown=node:node plugins/task-ai /home/node/.claude/plugins/cache/moonview/task-ai/latest

# Copy entrypoint script
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Generate self-signed SSL certificate (readable by notebook user)
RUN openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /app/packages/web/localhost-key.pem \
    -out /app/packages/web/localhost.pem \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:0.0.0.0" \
    && chmod 644 /app/packages/web/localhost*.pem

# Environment
ENV NODE_ENV=production
ENV NB_WORKSPACE_DIR=/data/workspaces
ENV NB_DB_PATH=/data/notebook.db
ENV PORT=3000
ENV HOME=/home/node

# Install gosu for dropping privileges
RUN apt-get update && apt-get install -y gosu && rm -rf /var/lib/apt/lists/*

# Production mode: backend serves API + static files on single port
WORKDIR /app/packages/server

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

EXPOSE 3000
