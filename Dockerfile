# Build: install deps (build tools for better-sqlite3 if no prebuilt binary).
FROM node:22-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run: standalone server + git. safe.directory: mounted repos have a foreign owner.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/* \
  && git config --system safe.directory '*' \
  && mkdir -p /data /repos /sandbox && chown node:node /data /sandbox
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data REPO_ROOT=/repos
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/drizzle ./drizzle
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
EXPOSE 3000
# Starts as root to fix /data ownership, then runs the app as `node`.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
