# Ship Shift for Render: audience floors only. Plain-text Messages API Chefs, all state in memory.
# No git and no Agent SDK in the image: the showcase floor (SHOWCASE=1) runs only on the presenter's laptop.
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && rm -rf node_modules/@anthropic-ai/claude-agent-sdk \
 && npm cache clean --force
COPY . .

ENV NODE_ENV=production \
    PORT=8080 \
    SHIP_NO_QR=1
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
