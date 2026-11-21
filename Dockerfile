# Ship Shift in public demo mode: a private, simulated kitchen per visitor. No Claude credentials are needed or used.
FROM node:22-slim

# The kitchens are real git repos with real worktrees and merges.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# The Agent SDK is only ever loaded by a real chef. Public mode has none, so it is removed from the image outright.
RUN npm ci --omit=dev \
 && rm -rf node_modules/@anthropic-ai \
 && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    SHIP_PUBLIC=1 \
    SHIP_SESSIONS_DIR=/tmp/ship-shift/sessions \
    PORT=8080
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--public"]
