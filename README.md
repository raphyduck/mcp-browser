# human-browser-mcp

MCP server exposing a stealth Playwright browser with human-like behaviour (ghost cursor, Gaussian typing, non-linear scroll, persistent profile).

Supports two transports:
- **stdio** — for Claude Desktop / local use
- **HTTP/SSE** — for claude.ai remote connectors (MCP 2025-03-26 + OAuth 2.0 PKCE)

---

## Quick start (local, stdio)

```bash
cd human-browser-mcp
npm install
npx playwright install chromium --with-deps
npm run build
node dist/index.js
```

## Configuration – Claude Desktop (stdio)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "human-browser": {
      "command": "node",
      "args": ["/absolute/path/to/human-browser-mcp/dist/index.js"],
      "env": {
        "HEADLESS": "true",
        "BROWSER_TIMEOUT": "30000"
      }
    }
  }
}
```

### Via Docker (stdio)

```bash
docker build -t human-browser-mcp ./human-browser-mcp

# -i is REQUIRED for MCP stdio
docker run -i --rm \
  -v human-browser-profile:/app/profile \
  -e MCP_TRANSPORT=stdio \
  human-browser-mcp
```

---

## HTTP/SSE mode — for claude.ai (OAuth 2.0)

### Environment variables

Create a `.env` file at the repo root:

```bash
OAUTH_CLIENT_ID=human-browser-mcp
OAUTH_CLIENT_SECRET=<random-secret-min-32-chars>
OAUTH_ISSUER=https://brmcp.hobbitton.at
MCP_AUTH_TOKEN=          # optional: static Bearer for curl/testing
```

### Start with docker compose

```bash
docker compose up -d --build
```

The server listens on `:3000`. Reverse-proxy with nginx/Caddy to your domain.

### Configure claude.ai

In claude.ai → Settings → Integrations → Add MCP server:
- **URL**: `https://brmcp.hobbitton.at/mcp`
- **OAuth Client ID**: value of `OAUTH_CLIENT_ID`
- **OAuth Client Secret**: value of `OAUTH_CLIENT_SECRET`

Claude.ai will discover the OAuth endpoints automatically via:
`GET https://brmcp.hobbitton.at/.well-known/oauth-authorization-server`

### OAuth flow (automatic, no user login page)

```
claude.ai → GET /oauth/authorize?client_id=...&code_challenge=...&redirect_uri=...
         ← 302 redirect_uri?code=<code>
claude.ai → POST /oauth/token {code, code_verifier, client_secret}
         ← {access_token, token_type: "Bearer", expires_in: 86400}
claude.ai → POST /mcp  Authorization: Bearer <access_token>
```

Tokens expire after 24 h. Auth codes expire after 10 min.

### Verify

```bash
# 1. OAuth discovery
curl https://brmcp.hobbitton.at/.well-known/oauth-authorization-server

# 2. Authorize redirect (expects 302)
curl -v "https://brmcp.hobbitton.at/oauth/authorize?\
client_id=human-browser-mcp&\
redirect_uri=https://example.com/callback&\
state=test123&\
code_challenge=abc&\
code_challenge_method=S256&\
response_type=code"

# 3. /mcp without token must return 401
curl -s -o /dev/null -w "%{http_code}" https://brmcp.hobbitton.at/mcp

# 4. Health check (no auth)
curl https://brmcp.hobbitton.at/health
```

---

## Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP listen port |
| `MCP_AUTH_TOKEN` | _(empty)_ | Static Bearer fallback (curl testing) |
| `OAUTH_CLIENT_ID` | _(empty)_ | OAuth client identifier |
| `OAUTH_CLIENT_SECRET` | _(empty)_ | OAuth client secret |
| `OAUTH_ISSUER` | `http://localhost:3000` | Public base URL for OAuth metadata |
| `HEADLESS` | `true` | Set to `false` to show the browser window |
| `SLOW_MO` | `0` | Extra ms between Playwright actions |
| `BROWSER_TIMEOUT` | `30000` | Default selector/navigation timeout |
| `NAVIGATE_SETTLE_MS` | `500` | DOM-settle window after navigation |
| `NAVIGATE_SETTLE_CAP_MS` | `3000` | Hard cap on the navigation settle wait |
| `CLICK_SETTLE_MS` | `300` | DOM-settle window after a click |
| `CLICK_SETTLE_CAP_MS` | `3000` | Hard cap on the click settle wait |
| `MARK_MAX_ELEMENTS` | `200` | Default cap for `browser_mark_page` |
| `CAPSOLVER_API_KEY` | _(unset)_ | Enables `browser_solve_captcha` |

---

## Available tools (21)

### Navigation
- `browser_navigate` – go to URL. `waitUntil`: `domcontentloaded` (default, then a
  DOM settle) · `load` · `networkidle` (opt-in only) · `none` (commit, no settle).
  Optional `settle_ms`.
- `browser_back` / `browser_forward` / `browser_refresh`
- `browser_get_url` – return current URL

### Reading
- `browser_get_content` – visible text (whole page or selector)
- `browser_screenshot` – PNG as base64 (whole page or element)
- `browser_mark_page` – **set-of-marks**: stamp every visible interactive element
  with `data-som-id="N"`, return an annotated screenshot + a compact JSON map.
  Click them later with `[data-som-id="N"]`. Options: `viewport_only` (default
  true), `max_elements` (default 200).
- `browser_wait_for` – wait for a CSS selector to be visible/hidden/etc.

### Interactions
- `browser_click` – ghost-cursor click (realistic mouse path). Options: `settle_ms`, `frame`.
- `browser_type` – Gaussian-delay typing (30–120 ms/char). Options: `clearFirst`, `frame`.
- `browser_clear_and_type` – clear field then type. Option: `frame`.
- `browser_select` – pick a `<select>` option. Option: `frame`.
- `browser_hover` – ghost-cursor hover. Option: `frame`.
- `browser_scroll` – non-linear scroll with micro-pauses
- `browser_press_key` – keyboard key with optional modifiers
- `browser_evaluate` – run arbitrary JS in page context

`frame` is an optional hint (frame **name** | **url substring** | **numeric
index**) to target an element inside an iframe. Omit it to auto-detect: the main
frame is tried first, then each child frame.

### Session
- `browser_get_cookies` / `browser_set_cookies` / `browser_clear_cookies`

### CapSolver (optional)
- `browser_solve_captcha` – solve reCAPTCHA v2/v3, hCaptcha, Turnstile

---

## Response formats

**Mutating actions** (`navigate`, `click`, `type`, `clear_and_type`, `select`,
`press_key`) return a compact JSON state block — no separate `get_url` needed:

```json
{ "ok": true, "url": "https://example.com/step-2", "title": "Step 2", "navigated": true, "note": "URL changed during the action" }
```

**`browser_mark_page`** returns two blocks: an image (annotated screenshot) and a
JSON map:

```json
{ "count": 23, "elements": [ { "id": 1, "tag": "input", "type": "email", "text": "Email address", "frame": "main" } ] }
```

**Failures** return a structured error instead of a raw stack:

```json
{ "ok": false, "error": { "code": "MULTIPLE_MATCHES", "selector": "button.submit", "count": 3, "candidates": ["Valider", "Annuler", "Enregistrer"], "message": "..." } }
```

Error codes: `NOT_FOUND`, `MULTIPLE_MATCHES`, `NOT_VISIBLE`, `INTERCEPTED`,
`DETACHED`, `TIMEOUT`, `FRAME_NOT_FOUND`, `UNKNOWN`. A screenshot is attached to
errors when one can be captured.

---

## Reliability behaviour

- **Auto-wait on navigate**: after `goto`, waits for the DOM to go quiet
  (default 500 ms, capped 3 s). `networkidle` is never the default — on sites
  with websockets/long-polling/analytics it may never fire. Use `waitUntil:"none"`
  to skip the settle.
- **Auto-wait on click**: keeps Playwright's native actionability wait and adds a
  post-click settle (default 300 ms, capped 3 s) so SPA re-renders stabilise
  before the call returns — no manual `wait_for` needed.
- **iframe & shadow DOM**: selectors resolve across child frames; open shadow
  roots are pierced natively by Playwright's CSS engine.

### Known limitations

- **Closed shadow roots** cannot be pierced (browser security) — not supported.
- `browser_mark_page` uses `querySelectorAll`, which does **not** descend into
  shadow roots, so shadow-DOM controls are not numbered (they remain reachable
  by direct CSS selector for click/type).
- Cross-frame elements use a **native** click/hover (not the ghost-cursor
  trajectory); the human cursor path applies to main-frame elements only.
- `networkidle` is opt-in, never default (see above).

---

## Tests

A deterministic local fixture (form, a button rendered after 800 ms, an iframe
with a field, and an open-shadow-root web component) exercises every tool:

```bash
npm install
npx playwright install chromium --with-deps
npm test            # builds, then runs test/run.mjs against test/fixture.html
```

A local fixture is used (not a public site) for determinism: no captcha, no
network flakiness. Current status: **19/19 assertions pass**.

---

## Stealth features

- `playwright-extra` + `puppeteer-extra-plugin-stealth`
- `navigator.webdriver = false`
- Chrome 124 user-agent on Windows 11
- WebGL vendor: Intel Iris (not SwiftShader)
- Languages: `fr-FR, fr, en-US, en`
- Timezone: `Europe/Paris`
- Simulated Chrome plugins & runtime object
- Persistent profile via `./profile/` (cookies survive restarts)
