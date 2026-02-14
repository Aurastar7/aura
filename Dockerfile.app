FROM node:20-bookworm-slim

WORKDIR /app

# bcrypt may need native build tooling depending on the target platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "server/sync-server.mjs"]
