# ---- Build stage: install deps and build the frontend ------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Need python+make+g++ for better-sqlite3 native compile
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Remove dev dependencies to shrink the runtime image
RUN npm prune --omit=dev

# ---- Runtime stage -----------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

# Runtime tools:
#  - ffmpeg/ffprobe for seedbox remux and transcode
#  - openssh-client so the ssh2 npm module can reuse host known_hosts if needed
RUN apk add --no-cache ffmpeg openssh-client tini

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/ecosystem.config.cjs ./ecosystem.config.cjs

# Persistent SQLite DB location — mapped to a named volume at runtime
RUN mkdir -p /app/server/db

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

# Use tini for proper signal handling (graceful shutdown + reaping zombies)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--max-http-header-size=65536", "server/index.js"]
