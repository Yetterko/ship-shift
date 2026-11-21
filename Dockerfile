# Ship Shift in public mode: a private restaurant per visitor, each with its own git copy of the roster-cafe project.
# Set SHIP_SHARED_KEY as a secret for Claude (Haiku) customer reviews; without it the customers are scripted and nothing costs money.
FROM node:22-slim

# The restaurants are real git repos with real worktrees and merges.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# @anthropic-ai/sdk writes the customers' reviews; the Agent SDK runs real chefs for visitors who bring their own key.
RUN npm ci --omit=dev \
 && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    SHIP_PUBLIC=1 \
    SHIP_SESSIONS_DIR=/tmp/ship-shift/sessions \
    SHIP_FLAGSHIP_DIR=/tmp/ship-shift/flagship \
    PORT=8080
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--public"]
