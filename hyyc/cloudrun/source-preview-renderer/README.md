# Source preview renderer

This service opens a public HTTPS article with Playwright and returns consecutive JPEG viewport screenshots based on the page height, with a twelve-segment safety ceiling. It is intentionally separate from the CloudBase function because Chromium is not suitable for a normal serverless function runtime.

## Runtime contract

- `GET /health` returns readiness without exposing credentials.
- `POST /capture` requires `Authorization: Bearer <CAPTURE_TOKEN>` and accepts `{ "url": "https://...", "maxSegments": 12, "captureVersion": 2, "profile": "focus-v1" }`.
- `focus-v1` first selects the primary article from DOM semantics (with an X/Twitter status adapter), scrolls it to trigger lazy media, waits for fonts and meaningful images such as avatars to load, then captures only that content boundary. It falls back to page segments when confidence is low.
- Only one capture runs at a time. Requests are bounded by body, response, image, navigation and total time limits.
- The service accepts only public HTTPS targets and blocks service workers and private/reserved addresses.

## Required environment

```text
HOST=127.0.0.1
PORT=8791
CAPTURE_TOKEN=<at least 32 random characters>
PLAYWRIGHT_PROXY_URL=http://127.0.0.1:7890
PLAYWRIGHT_BROWSERS_PATH=/opt/source-preview/browsers
```

Production startup is fail-closed without a loopback proxy. That proxy must reject private, loopback, link-local, carrier-grade NAT, documentation, multicast and other reserved destinations after its own DNS resolution. `ALLOW_DIRECT_EGRESS=true` exists only for controlled local tests where equivalent OS-level egress filtering is already enforced.

## Public deployment shape

Run Node as a dedicated unprivileged user, bind the renderer to loopback, and expose only an authenticated Nginx route such as `/source-preview/`. Keep the proxy on loopback as well. A typical direct-host release lives under `/opt/source-preview/releases/<timestamp>` with `/opt/source-preview/current` pointing to the active release.

Install dependencies and the full Chromium build with:

```text
npm ci --omit=dev
npx playwright install chromium
```

The supplied Dockerfile runs as Playwright's unprivileged `pwuser`. In a container deployment, provide the required proxy in the same network namespace or an equivalent local sidecar.

## CloudBase integration

`knowledgeFeed` reads the public renderer URL and tokens from environment variables. Visual maintenance runs only when the Cloud Function runtime reports `TRIGGER_SRC=timer`; the mini-program action router exposes only `feed` and `item`. Preview service calls still require an independent maintenance token. Generated files are stored under `knowledge-previews/source/`; feed refreshes transactionally preserve active visuals and delete only orphaned files under the owned cover/preview prefixes.

Never commit tokens, server credentials or `config.local.js`. Local copies belong under the ignored `wiki/secrets/` directory.
