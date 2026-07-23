FROM mcr.microsoft.com/playwright:v1.57.0-noble@sha256:3bed4b1a12f2338642f3d8cba28e291deef3c66bd4a964bbeb3e57bbff511dbd

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Production startup is fail-closed unless ALLOW_DIRECT_EGRESS=true starts the
# renderer's own loopback CONNECT proxy. Generic PLAYWRIGHT_PROXY_URL endpoints
# are rejected because their DNS and destination policy cannot be proven here.

COPY docker/package.json docker/package-lock.json ./
RUN npm ci --omit=dev --no-audit

COPY src ./src
COPY scripts ./scripts

USER pwuser

EXPOSE 8080
CMD ["node", "src/server.js"]
