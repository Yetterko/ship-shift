# Ship Shift in public demo mode: a private kitchen per visitor. The chefs are simulated unless ANTHROPIC_API_KEY is set,
# in which case they are Claude Haiku through the Messages API (SHIP_PUBLIC_API=1 below), with file tools only and no shell.
FROM node:22-slim

# The kitchens are real git repos with real worktrees and merges.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
# The Agent SDK is only ever loaded by a real chef on your own machine. Public mode has none, so it is removed from the image
# outright. The API SDK (@anthropic-ai/sdk) stays: the API chefs use it.
RUN npm ci --omit=dev \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk \
 && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    SHIP_PUBLIC=1 \
    SHIP_PUBLIC_API=1 \
    SHIP_WORLD=0 \
    SHIP_SESSIONS_DIR=/tmp/ship-shift/sessions \
    PORT=8080
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs", "--public"]
