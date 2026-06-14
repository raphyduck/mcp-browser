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
| `CAPSOLVER_API_KEY` | _(unset)_ | Enables `browser_solve_captcha` |

---

## Available tools (20)

### Navigation
- `browser_navigate` – go to URL
- `browser_back` / `browser_forward` / `browser_refresh`
- `browser_get_url` – return current URL

### Reading
- `browser_get_content` – visible text (whole page or selector)
- `browser_screenshot` – PNG as base64 (whole page or element)
- `browser_wait_for` – wait for a CSS selector to be visible/hidden/etc.

### Interactions
- `browser_click` – ghost-cursor click (realistic mouse path)
- `browser_type` – Gaussian-delay typing (30–120 ms/char)
- `browser_clear_and_type` – clear field then type
- `browser_select` – pick a `<select>` option
- `browser_hover` – ghost-cursor hover
- `browser_scroll` – non-linear scroll with micro-pauses
- `browser_press_key` – keyboard key with optional modifiers
- `browser_evaluate` – run arbitrary JS in page context

### Session
- `browser_get_cookies` / `browser_set_cookies` / `browser_clear_cookies`

### CapSolver (optional)
- `browser_solve_captcha` – solve reCAPTCHA v2/v3, hCaptcha, Turnstile

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
