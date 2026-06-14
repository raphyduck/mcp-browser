# human-browser-mcp

MCP server exposing a stealth Playwright browser with human-like behaviour (ghost cursor, Gaussian typing, non-linear scroll, persistent profile).

Supports two transports:
- **stdio** — for Claude Desktop / local use
- **HTTP/SSE** — for claude.ai remote connectors (MCP 2025-03-26 streamable HTTP spec)

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
        "BROWSER_TIMEOUT": "30000",
        "CAPSOLVER_API_KEY": ""
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

Claude Desktop config (Docker variant):

```json
{
  "mcpServers": {
    "human-browser": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-v", "human-browser-profile:/app/profile",
        "-e", "MCP_TRANSPORT=stdio",
        "-e", "HEADLESS=true",
        "human-browser-mcp"
      ]
    }
  }
}
```

---

## HTTP/SSE mode — for claude.ai

### Start with docker compose

```bash
# Set your auth token
export MCP_AUTH_TOKEN=your-secret-token

docker compose up -d
```

The server listens on `:3000`. Reverse-proxy it with nginx/Caddy to expose it at your domain (e.g. `https://browser.hobbitton.at/mcp`).

### Configure claude.ai

In claude.ai → Settings → Integrations → Add MCP server:
- **URL**: `https://browser.hobbitton.at/mcp`
- **Auth**: Bearer `your-secret-token`

### Verify

```bash
# Health check (no auth needed)
curl http://localhost:3000/health

# Open SSE stream (auth required)
curl -H "Authorization: Bearer your-secret-token" \
     -H "Accept: text/event-stream" \
     http://localhost:3000/mcp
```

The second command should open a persistent SSE connection and stay open.

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PORT` | `3000` | HTTP listen port |
| `MCP_AUTH_TOKEN` | _(empty)_ | Bearer token (required in HTTP mode) |
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
