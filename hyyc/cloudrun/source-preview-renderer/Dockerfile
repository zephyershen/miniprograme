FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Production startup is fail-closed unless PLAYWRIGHT_PROXY_URL points to a
# loopback-only proxy that rejects private and reserved destinations.

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

USER pwuser

EXPOSE 8080
CMD ["node", "src/server.js"]
