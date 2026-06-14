# human-browser-mcp

MCP server exposing a stealth Playwright browser with human-like behaviour (ghost cursor, Gaussian typing, non-linear scroll, persistent profile).

## Quick start

```bash
cd human-browser-mcp
npm install
npx playwright install chromium --with-deps
npm run build
node dist/index.js
```

## Configuration – Claude Desktop

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

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `HEADLESS` | `true` | Set to `false` to show the browser window |
| `SLOW_MO` | `0` | Extra ms between Playwright actions |
| `BROWSER_TIMEOUT` | `30000` | Default selector/navigation timeout |
| `CAPSOLVER_API_KEY` | _(unset)_ | Enables `browser_solve_captcha` |

## Docker

```bash
docker build -t human-browser-mcp ./human-browser-mcp
docker run -i --rm \
  -v human-browser-profile:/app/profile \
  -e HEADLESS=true \
  human-browser-mcp
```

## Available tools

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

## Stealth features

- `playwright-extra` + `puppeteer-extra-plugin-stealth`
- `navigator.webdriver = false`
- Chrome 124 user-agent on Windows 11
- WebGL vendor: Intel Iris (not SwiftShader)
- Languages: `fr-FR, fr, en-US, en`
- Timezone: `Europe/Paris`
- Simulated Chrome plugins & runtime object
- Persistent profile via `./profile/` (cookies survive restarts)
