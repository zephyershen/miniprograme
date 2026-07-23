# Source preview renderer

This package opens a public HTTPS article with Playwright and returns consecutive JPEG viewport screenshots based on the page height, with a twelve-segment safety ceiling. It supports both the container HTTP service and the isolated `sourcePreviewWorker` CloudBase function.

## Runtime contract

- `GET /health` returns readiness without exposing credentials.
- `POST /capture` requires `Authorization: Bearer <CAPTURE_TOKEN>` and accepts `{ "url": "https://...", "maxSegments": 12, "captureVersion": 3, "profile": "focus-v1" }`.
- `focus-v1` first selects the primary article from DOM semantics (with an X/Twitter status adapter), scrolls it to trigger lazy media, waits for fonts and meaningful images such as avatars to load, then captures only that content boundary. Generic sources can fall back to page segments when confidence is low; an X/Twitter status must match the requested status ID and never falls back to an unrelated full page.
- Before capture and again immediately before publishing the in-memory screenshots, the renderer rejects known HTTP-200 error shells, login walls, browser challenges, blank pages and missing target statuses. The first quality rejection, transient navigation failure or upstream 5xx gets one bounded reload; 4xx, blocked destinations and aborts do not. Successful responses include `quality.policyVersion`, `quality.verdict`, `quality.targetMatched`, `quality.reviewRequired` and `quality.reasonCode`; generic pages remain eligible for a downstream visual-model review.
- Only one capture runs at a time. Requests are bounded by body, response, image, navigation and total time limits.
- The service accepts only public HTTPS targets and blocks service workers and private/reserved addresses. Browser routing is defense in depth; the browser itself never resolves a source hostname for egress. Direct captures use an in-process loopback CONNECT proxy that connects only to the guard's validated IP. Relay captures also pass IP literals to the upstream proxy. TLS remains end-to-end in Chromium, so SNI and certificate hostname validation still use the original source hostname, and every redirect is revalidated.

## Required environment

```text
HOST=127.0.0.1
PORT=8791
CAPTURE_TOKEN=<at least 32 random characters>
ALLOW_DIRECT_EGRESS=true
PLAYWRIGHT_BROWSERS_PATH=/opt/source-preview/browsers
```

Production startup is fail-closed unless `ALLOW_DIRECT_EGRESS=true` starts the built-in loopback CONNECT proxy. Despite the legacy variable name, this no longer gives Chromium direct network access: each tunnel is resolved, validated, and connected to a fixed public IP by Node. `PLAYWRIGHT_PROXY_URL` is rejected because a generic loopback HTTP/SOCKS proxy can resolve an attacker-controlled hostname again after validation.

Clear-text HTTP is not permitted. Browser-context routing covers every page and popup, and independently validates secure WebSocket destinations. Chromium also forces loopback/link-local requests through the guarded proxy, disables QUIC, and disallows non-proxied WebRTC UDP. `data:` and `blob:` resources are allowed only inside the page and never leave the browser.

## Public deployment shape

Run Node as a dedicated unprivileged user, bind the renderer to loopback, and expose only an authenticated Nginx route such as `/source-preview/`. Keep the proxy on loopback as well. A typical direct-host release lives under `/opt/source-preview/releases/<timestamp>` with `/opt/source-preview/current` pointing to the active release.

Install dependencies and the full Chromium build with:

```text
npm ci --omit=dev
npm ci --prefix docker
npm run verify:runtimes
npm exec --prefix docker -- playwright install chromium
npm run smoke:browser -- docker
```

The supplied Dockerfile and both Playwright packages are pinned to `1.57.0`, whose Chromium major is 143. The CloudBase path is pinned to `@sparticuz/chromium@143.0.4`, keeping both execution paths on Chromium 143 while retaining Node 20 support. The supplied Dockerfile runs as Playwright's unprivileged `pwuser`.
The container installs only `docker/package-lock.json` (Playwright); the
CloudBase package installs only Playwright Core, Sparticuz Chromium, the relay
client, and the Cloud SDK. The local container-path smoke test resolves full
Playwright from `docker/node_modules`, keeping the two production dependency
graphs separate.

Before a CloudBase release, run the serverless binary gate in a clean Node 20 Linux x64 environment:

```text
npm ci --omit=dev
npm run verify:runtimes
npm run smoke:browser -- cloudbase-function
```

## CloudBase integration

`knowledgeFeed` reads the public renderer URL and tokens from environment variables. Visual maintenance runs only when the Cloud Function runtime reports `TRIGGER_SRC=timer`; the mini-program action router exposes only `feed` and `item`. Preview service calls still require an independent maintenance token. Generated files are stored under `knowledge-previews/source/`; feed refreshes transactionally preserve active visuals and delete only orphaned files under the owned cover/preview prefixes.

Never commit tokens, server credentials or `config.local.js`. Local copies belong under the ignored `wiki/secrets/` directory.
# CloudBase function runtime

The same renderer package is deployed as the `sourcePreviewWorker` CloudBase
function. Its runtime configuration is managed outside `cloudbaserc.json` so a
code deployment cannot overwrite secret environment variables. Configure these
variables on the function:

- `SOURCE_PREVIEW_EXECUTION_ENV=cloudbase-function`
- `ALLOW_DIRECT_EGRESS=true` (enables the built-in fixed-IP proxy; Chromium itself remains proxied)
- `SOURCE_PREVIEW_RELAY_URL=wss://<relay-host>/source-proxy/tunnel`
- `SOURCE_PREVIEW_RENDERER_TOKEN=<shared service token>`

Ordinary HTTPS pages use the fixed-IP proxy inside CloudBase. X/Twitter always
use the encrypted relay, and other hosts retry through it only after a connectivity
or regional-access failure. The relay resolves and validates the target, then
passes a fixed IP literal even when its own upstream CONNECT proxy is used. The
relay transports bytes only; Chromium retains the original hostname for TLS
validation, while quality inspection, AI review, and cloud-storage writes stay
in CloudBase.

The `knowledgeFeed` caller keeps its HTTP renderer fallback disabled in
production. A failed SCF capture remains a retryable visual job and never sends
rendering work back to the relay host.
