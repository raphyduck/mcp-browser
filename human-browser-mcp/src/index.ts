import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

import {
  browserNavigate,
  browserBack,
  browserForward,
  browserRefresh,
  browserGetUrl,
  browserGetContent,
  browserScreenshot,
  browserMarkPage,
  browserSnapshot,
  browserWaitFor,
  browserClick,
  browserType,
  browserClearAndType,
  browserSelect,
  browserHover,
  browserScroll,
  browserPressKey,
  browserEvaluate,
  browserGetCookies,
  browserSetCookies,
  browserClearCookies,
  browserSolveCaptcha,
  browserSolveCloudflare,
} from './actions.js';
import { browserManager, sessionStore } from './browser.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  // Navigation
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL' },
        waitUntil: {
          type: 'string',
          enum: ['domcontentloaded', 'load', 'networkidle', 'none'],
          description:
            "Load state to wait for (default: domcontentloaded, then a DOM settle). 'none' returns on commit with no settle. 'networkidle' is opt-in only — it may never fire on sites with websockets/long-polling.",
        },
        settle_ms: {
          type: 'number',
          description: 'Override the post-load DOM-settle window in ms (default 500, capped at 3000)',
        },
        solve_cloudflare: {
          type: 'boolean',
          description: "Resout automatiquement un challenge Cloudflare apres navigation (defaut true). Mettre false pour desactiver.",
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back in browser history',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_forward',
    description: 'Go forward in browser history',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_refresh',
    description: 'Reload the current page',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_get_url',
    description: 'Return the current page URL',
    inputSchema: { type: 'object', properties: {} },
  },

  // Reading
  {
    name: 'browser_get_content',
    description: 'Return visible text of the page (or a specific element)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector (optional, defaults to whole page)' },
      },
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot and return it as base64 PNG',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to capture (optional)' },
        fullPage: { type: 'boolean', description: 'Capture full page (default false)' },
      },
    },
  },
  {
    name: 'browser_mark_page',
    description:
      'Set-of-marks: stamp every visible interactive element with data-som-id="N", overlay numbered boxes, and return an annotated screenshot plus a compact JSON map. Click marked elements later with selector [data-som-id="N"].',
    inputSchema: {
      type: 'object',
      properties: {
        viewport_only: {
          type: 'boolean',
          description: 'Only mark elements inside the current viewport (default true)',
        },
        max_elements: {
          type: 'number',
          description: 'Safety cap on the number of marked elements (default 200)',
        },
      },
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Accessibility-tree snapshot of the page (YAML, AI mode): roles, accessible names and element refs [ref=eN], including iframes. Cheaper and more reliable than screenshots for planning actions. Use any ref directly as the selector of click/type/hover/select tools (e.g. selector "e12" or "ref=e12"). Refs expire when the page changes: re-snapshot after navigation.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to scope the snapshot (optional, defaults to body)',
        },
        depth: { type: 'number', description: 'Limit tree depth (optional)' },
        boxes: {
          type: 'boolean',
          description: 'Append viewport bounding boxes [box=x,y,w,h] to each element (default false)',
        },
      },
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until a CSS selector is in the given state',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout: { type: 'number', description: 'Timeout in ms (default: BROWSER_TIMEOUT env var)' },
        state: {
          type: 'string',
          enum: ['attached', 'detached', 'visible', 'hidden'],
          description: 'Element state to wait for (default: visible)',
        },
      },
      required: ['selector'],
    },
  },

  // Interactions
  {
    name: 'browser_click',
    description: 'Human-like click on an element via ghost-cursor (realistic mouse trajectory)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to click' },
        settle_ms: {
          type: 'number',
          description: 'Post-click DOM-settle window in ms (default 300, capped at 3000)',
        },
        frame: {
          type: 'string',
          description: 'Optional frame hint (name | url substring | numeric index) to target an iframe',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_type',
    description: 'Type text character by character with Gaussian typing delays (30–120 ms/char)',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
        clearFirst: { type: 'boolean', description: 'Select-all before typing (default false)' },
        frame: {
          type: 'string',
          description: 'Optional frame hint (name | url substring | numeric index) to target an iframe',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_clear_and_type',
    description: 'Clear an input field then type text with human delays',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of input element' },
        text: { type: 'string', description: 'Text to type' },
        frame: {
          type: 'string',
          description: 'Optional frame hint (name | url substring | numeric index) to target an iframe',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option in a <select> element',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of <select>' },
        value: { type: 'string', description: 'Option value to select' },
        frame: {
          type: 'string',
          description: 'Optional frame hint (name | url substring | numeric index) to target an iframe',
        },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_hover',
    description: 'Move the mouse over an element with a realistic ghost-cursor path',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of element to hover' },
        frame: {
          type: 'string',
          description: 'Optional frame hint (name | url substring | numeric index) to target an iframe',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page with non-linear micro-paused chunks',
    inputSchema: {
      type: 'object',
      properties: {
        deltaX: { type: 'number', description: 'Horizontal scroll amount in pixels (default 0)' },
        deltaY: { type: 'number', description: 'Vertical scroll amount in pixels (default 300, negative = up)' },
        selector: { type: 'string', description: 'CSS selector to scroll into view first (optional)' },
        steps: { type: 'number', description: 'Number of scroll micro-steps (auto-computed if omitted)' },
      },
    },
  },
  {
    name: 'browser_press_key',
    description: 'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown)',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Playwright key name (e.g. Enter, Tab, Escape)' },
        modifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Modifier keys to hold (e.g. ["Shift", "Control"])',
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_evaluate',
    description: 'Execute arbitrary JavaScript in the page context and return the result',
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript expression or IIFE to evaluate' },
      },
      required: ['script'],
    },
  },

  // Session
  {
    name: 'browser_get_cookies',
    description: 'Return all cookies from the current browser context',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'browser_set_cookies',
    description: 'Add or update cookies in the current browser context',
    inputSchema: {
      type: 'object',
      properties: {
        cookies: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              value: { type: 'string' },
              domain: { type: 'string' },
              path: { type: 'string' },
              httpOnly: { type: 'boolean' },
              secure: { type: 'boolean' },
              sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
            },
            required: ['name', 'value', 'domain'],
          },
          description: 'Array of cookie objects',
        },
      },
      required: ['cookies'],
    },
  },
  {
    name: 'browser_clear_cookies',
    description: 'Clear all cookies from the current browser context',
    inputSchema: { type: 'object', properties: {} },
  },

  // CapSolver (optional)
  {
    name: 'browser_solve_captcha',
    description:
      'Detect and solve a captcha on the current page using CapSolver (requires CAPSOLVER_API_KEY env var)',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            'Captcha type: ReCaptchaV2Task, ReCaptchaV3Task, HCaptchaTask, AntiTurnstileTask',
        },
        websiteKey: {
          type: 'string',
          description:
            'Optional: provide the captcha sitekey directly instead of auto-detecting from DOM',
        },
        isInvisible: {
          type: 'boolean',
          description:
            'Optional: set to true for invisible reCaptcha v2 (default: false)',
        },
      },
    },
  },
  {
    name: 'browser_solve_cloudflare',
    description: "Resout le challenge Cloudflare 'Un instant...' de la page courante via CapSolver (relais + IP FR partagee) et injecte le cf_clearance partitionne, puis recharge. browser_navigate le fait deja automatiquement ; cet outil sert a forcer/retenter manuellement. Optionnel: 'url' pour cibler une URL precise.",
    inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL cible du challenge (defaut: page courante)' } } },
  },
];

// ── Multi-session : parametre `tab` injecte dans chaque outil ────────────────
// La passerelle MCP (claude.ai) est stateless : elle regenere un mcp-session-id
// a CHAQUE appel d'outil et n'envoie aucun identifiant stable de conversation.
// Le serveur ne peut donc pas deviner a quelle session appartient un appel.
// Solution : l'appelant fournit un identifiant `tab` (ex: un nom stable par
// conversation) et le REUTILISE. Meme `tab` => meme onglet (continuite) ;
// `tab` differents => onglets isoles (plusieurs sessions en parallele).
// Sans `tab`, tout retombe sur l'onglet 'default' partage.
for (const t of TOOLS as any[]) {
  t.inputSchema = t.inputSchema || { type: 'object', properties: {} };
  t.inputSchema.properties = t.inputSchema.properties || {};
  t.inputSchema.properties.tab = {
    type: 'string',
    description:
      "Identifiant d'onglet/session. Passe une valeur stable et REUTILISE-la a chaque appel d'une meme session de navigation (ex: un slug de la tache). Meme tab => meme onglet ; tabs differents => onglets isoles pour du parallele. Omis => onglet 'default' partage.",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch table
// ─────────────────────────────────────────────────────────────────────────────

type ActionFn = (args: any) => Promise<any>;

const ACTIONS: Record<string, ActionFn> = {
  browser_navigate: browserNavigate,
  browser_back: browserBack,
  browser_forward: browserForward,
  browser_refresh: browserRefresh,
  browser_get_url: browserGetUrl,
  browser_get_content: browserGetContent,
  browser_screenshot: browserScreenshot,
  browser_mark_page: browserMarkPage,
  browser_snapshot: browserSnapshot,
  browser_wait_for: browserWaitFor,
  browser_click: browserClick,
  browser_type: browserType,
  browser_clear_and_type: browserClearAndType,
  browser_select: browserSelect,
  browser_hover: browserHover,
  browser_scroll: browserScroll,
  browser_press_key: browserPressKey,
  browser_evaluate: browserEvaluate,
  browser_get_cookies: browserGetCookies,
  browser_set_cookies: browserSetCookies,
  browser_clear_cookies: browserClearCookies,
  browser_solve_captcha: browserSolveCaptcha,
  browser_solve_cloudflare: browserSolveCloudflare,
};

// ─────────────────────────────────────────────────────────────────────────────
// MCP Server factory (one instance per HTTP session, shared singleton browser)
// ─────────────────────────────────────────────────────────────────────────────

// Per-session FIFO mutex + async context: a single chat's calls serialize on
// their own tab, while different chats (sessions) run in parallel.
const sessionChains = new Map<string, Promise<unknown>>();
function runForSession<T>(sessionId: string, fn: () => Promise<T> | T): Promise<T> {
  const prev = sessionChains.get(sessionId) ?? Promise.resolve();
  const run = prev.then(() => sessionStore.run(sessionId, () => Promise.resolve(fn())));
  sessionChains.set(sessionId, run.then(() => {}, () => {}));
  return run;
}

function createMCPServer(): Server {
  const server = new Server(
    { name: 'human-browser', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: args } = request.params;
    const action = ACTIONS[name];
    if (!action) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    const a: any = args ?? {};
    const tabId: string = (typeof a.tab === 'string' && a.tab.trim()) ? a.tab.trim() : 'default';
    // On retire `tab` avant de passer les args a l'action (evite d'interferer avec ses champs).
    if ('tab' in a) { delete a.tab; }
    return runForSession(tabId, () => action(a));
  });

  return server;
}

// ─────────────────────────────────────────────────────────────────────────────
// stdio mode
// ─────────────────────────────────────────────────────────────────────────────

async function startStdio(): Promise<void> {
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('human-browser MCP server running on stdio\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// OAuth 2.0 in-memory stores
// ─────────────────────────────────────────────────────────────────────────────

interface AuthCodeEntry {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
}

const authCodes = new Map<string, AuthCodeEntry>();

// ── Persistent access-token store ────────────────────────────────────────────
// Tokens live for 24h but the process can restart (crash, redeploy). Keeping
// them only in memory means every restart silently logs the client out. We
// persist to the mounted profile volume so tokens survive restarts.
const TOKEN_STORE_PATH = process.env.TOKEN_STORE_PATH ?? '/app/profile/oauth-tokens.json';

function loadAccessTokens(): Map<string, number> {
  try {
    if (existsSync(TOKEN_STORE_PATH)) {
      const raw = JSON.parse(readFileSync(TOKEN_STORE_PATH, 'utf8')) as Record<string, number>;
      const now = Date.now();
      const m = new Map<string, number>();
      for (const [t, exp] of Object.entries(raw)) {
        if (exp > now) m.set(t, exp); // drop already-expired tokens on load
      }
      process.stderr.write(`[oauth] loaded ${m.size} access token(s) from disk\n`);
      return m;
    }
  } catch (err) {
    process.stderr.write(`[oauth] failed to load tokens: ${err}\n`);
  }
  return new Map<string, number>();
}

const accessTokens = loadAccessTokens();

let persistTimer: NodeJS.Timeout | null = null;
function persistAccessTokens(): void {
  // debounce: coalesce rapid writes into one disk flush
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      mkdirSync(dirname(TOKEN_STORE_PATH), { recursive: true });
      const now = Date.now();
      const obj: Record<string, number> = {};
      for (const [t, exp] of accessTokens.entries()) {
        if (exp > now) obj[t] = exp;
      }
      writeFileSync(TOKEN_STORE_PATH, JSON.stringify(obj), 'utf8');
    } catch (err) {
      process.stderr.write(`[oauth] failed to persist tokens: ${err}\n`);
    }
  }, 250);
}

// ── Refresh tokens (persisted) ─────────────────────────────────────────────
// Without refresh tokens the client is logged out every time the access token
// expires and must be re-authorized by hand. Refresh tokens are long-lived and
// NOT rotated, so a client retry with the same refresh token never fails.
const ACCESS_TOKEN_TTL_MS = parseInt(process.env.ACCESS_TOKEN_TTL_MS ?? String(7 * 86_400_000), 10);
const REFRESH_TOKEN_TTL_MS = parseInt(process.env.REFRESH_TOKEN_TTL_MS ?? String(180 * 86_400_000), 10);
const REFRESH_STORE_PATH = process.env.REFRESH_STORE_PATH ?? '/app/profile/oauth-refresh-tokens.json';

function loadRefreshTokens(): Map<string, number> {
  const m = new Map<string, number>();
  try {
    if (existsSync(REFRESH_STORE_PATH)) {
      const raw = JSON.parse(readFileSync(REFRESH_STORE_PATH, 'utf8')) as Record<string, number>;
      const now = Date.now();
      for (const [t, exp] of Object.entries(raw)) if (exp > now) m.set(t, exp);
      process.stderr.write(`[oauth] loaded ${m.size} refresh token(s) from disk\n`);
    }
  } catch (err) {
    process.stderr.write(`[oauth] failed to load refresh tokens: ${err}\n`);
  }
  return m;
}
const refreshTokens = loadRefreshTokens();

function persistRefreshTokens(): void {
  try {
    mkdirSync(dirname(REFRESH_STORE_PATH), { recursive: true });
    const now = Date.now();
    const obj: Record<string, number> = {};
    for (const [t, exp] of refreshTokens.entries()) if (exp > now) obj[t] = exp;
    writeFileSync(REFRESH_STORE_PATH, JSON.stringify(obj), 'utf8');
  } catch (err) {
    process.stderr.write(`[oauth] failed to persist refresh tokens: ${err}\n`);
  }
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash('sha256').update(codeVerifier).digest();
  return hash.toString('base64url') === codeChallenge;
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP/SSE mode
// ─────────────────────────────────────────────────────────────────────────────

async function startHttp(): Promise<void> {
  const port = parseInt(process.env.MCP_PORT ?? '3000', 10);
  const staticToken = process.env.MCP_AUTH_TOKEN ?? '';
  const oauthClientId = process.env.OAUTH_CLIENT_ID ?? '';
  const oauthClientSecret = process.env.OAUTH_CLIENT_SECRET ?? '';
  const issuer = process.env.OAUTH_ISSUER ?? `http://localhost:${port}`;

  const app = express();

  app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Session-Id', 'Accept', 'Cache-Control'],
    exposedHeaders: ['Mcp-Session-Id'],
    credentials: false,
  }));

  app.use(express.json());

  // ── Auth middleware: accepts OAuth access tokens OR static MCP_AUTH_TOKEN ──
  const authenticate = (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized', error_description: 'Bearer token required' });
      return;
    }
    const token = header.slice(7);

    // 1. Dynamic OAuth access token
    const expiresAt = accessTokens.get(token);
    if (expiresAt !== undefined) {
      if (Date.now() > expiresAt) {
        accessTokens.delete(token);
        persistAccessTokens(); // after delete
        res.set('WWW-Authenticate', 'Bearer error="invalid_token", error_description="Token expired"');
        res.status(401).json({ error: 'invalid_token', error_description: 'Token expired' });
        return;
      }
      next();
      return;
    }

    // 2. Static fallback (MCP_AUTH_TOKEN, for Claude Desktop / curl testing)
    if (staticToken && token === staticToken) {
      next();
      return;
    }

    res.status(401).json({ error: 'invalid_token', error_description: 'Unknown or expired token' });
  };

  // Session registry: sessionId → transport
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const sessionLastSeen = new Map<string, number>();
  const SESSION_IDLE_MS = parseInt(process.env.SESSION_IDLE_MS ?? String(30 * 60_000), 10);
  setInterval(() => {
    const now = Date.now();
    for (const [id, t] of sessions.entries()) {
      const last = sessionLastSeen.get(id) ?? 0;
      if (now - last > SESSION_IDLE_MS) {
        process.stderr.write(`[session] closing idle session ${id}\n`);
        sessions.delete(id);
        sessionLastSeen.delete(id);
        sessionChains.delete(id);
        void browserManager.closeSession(id);
        t.close().catch(() => {});
      }
    }
  }, 60_000).unref();

  // ── OAuth discovery ─────────────────────────────────────────────────────────
  app.get('/.well-known/oauth-authorization-server', (_req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/oauth/authorize`,
      token_endpoint: `${issuer}/oauth/token`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    });
  });

  // ── OAuth authorize ─────────────────────────────────────────────────────────
  app.get('/oauth/authorize', (req, res) => {
    const {
      client_id,
      redirect_uri,
      state,
      code_challenge,
      code_challenge_method,
      response_type,
    } = req.query as Record<string, string>;

    if (!oauthClientId) {
      res.status(500).json({ error: 'server_error', error_description: 'OAuth not configured' });
      return;
    }
    if (client_id !== oauthClientId) {
      res.status(400).json({ error: 'invalid_client' });
      return;
    }
    if (response_type !== 'code') {
      res.status(400).json({ error: 'unsupported_response_type' });
      return;
    }
    if (!redirect_uri || !code_challenge) {
      res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri and code_challenge required' });
      return;
    }
    if (code_challenge_method && code_challenge_method !== 'S256') {
      res.status(400).json({ error: 'invalid_request', error_description: 'Only S256 PKCE is supported' });
      return;
    }

    const code = generateToken();
    authCodes.set(code, {
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      expiresAt: Date.now() + 600_000, // 10 minutes
    });

    const callbackUrl = new URL(redirect_uri);
    callbackUrl.searchParams.set('code', code);
    if (state) callbackUrl.searchParams.set('state', state);

    res.redirect(302, callbackUrl.toString());
  });

  // ── OAuth token exchange ────────────────────────────────────────────────────
  app.post('/oauth/token', express.urlencoded({ extended: false }), (req, res) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = req.body as Record<string, string>;

    if (!oauthClientId || !oauthClientSecret) {
      res.status(500).json({ error: 'server_error', error_description: 'OAuth not configured' });
      return;
    }
    if (grant_type !== 'authorization_code' && grant_type !== 'refresh_token') {
      res.status(400).json({ error: 'unsupported_grant_type' });
      return;
    }
    if (client_id !== oauthClientId || client_secret !== oauthClientSecret) {
      res.status(401).json({ error: 'invalid_client' });
      return;
    }

    if (grant_type === 'refresh_token') {
      const rt = (req.body as Record<string, string>).refresh_token;
      const rtExp = rt ? refreshTokens.get(rt) : undefined;
      if (!rt || rtExp === undefined || Date.now() > rtExp) {
        if (rt) { refreshTokens.delete(rt); persistRefreshTokens(); }
        res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired refresh token' });
        return;
      }
      // sliding expiry on the refresh token
      refreshTokens.set(rt, Date.now() + REFRESH_TOKEN_TTL_MS);
      persistRefreshTokens();
      const newAccess = generateToken();
      accessTokens.set(newAccess, Date.now() + ACCESS_TOKEN_TTL_MS);
      persistAccessTokens();
      process.stderr.write(`[oauth] access token refreshed\n`);
      res.json({
        access_token: newAccess,
        token_type: 'Bearer',
        expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
        refresh_token: rt,
      });
      return;
    }

    const entry = authCodes.get(code);
    if (!entry) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'Unknown or expired code' });
      return;
    }
    if (Date.now() > entry.expiresAt) {
      authCodes.delete(code);
      res.status(400).json({ error: 'invalid_grant', error_description: 'Code expired' });
      return;
    }
    if (entry.redirectUri !== redirect_uri) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
      return;
    }
    if (!code_verifier || !verifyPKCE(code_verifier, entry.codeChallenge)) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      return;
    }

    authCodes.delete(code);

    const accessToken = generateToken();
    accessTokens.set(accessToken, Date.now() + ACCESS_TOKEN_TTL_MS);
    persistAccessTokens(); // after set
    const refreshToken = generateToken();
    refreshTokens.set(refreshToken, Date.now() + REFRESH_TOKEN_TTL_MS);
    persistRefreshTokens();
    process.stderr.write(`[oauth] new authorization: access + refresh token issued\n`);

    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_token: refreshToken,
    });
  });

  // ── Health check ────────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', transport: 'http', sessions: sessions.size });
  });

  // ── MCP endpoint (GET + POST + DELETE) ─────────────────────────────────────
  app.all('/mcp', authenticate, async (req: Request, res: Response) => {
    try {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      // Reuse existing session
      if (sessionId && sessions.has(sessionId)) {
        sessionLastSeen.set(sessionId, Date.now());
        const transport = sessions.get(sessionId)!;
        await transport.handleRequest(req, res, req.body);
        return;
      }

      // Unknown/expired session id: spec says 404, which makes the client
      // transparently start a new session (400 made it surface an error).
      if (sessionId && !(req.method === 'POST' && req.body && req.body.method === 'initialize')) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }

      // New session — only a POST (initialize) can create one
      if (req.method !== 'POST') {
        res.status(400).json({
          error: 'No active session. Send a POST initialize request to /mcp first.',
        });
        return;
      }

      let storedId: string | null = null;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          storedId = id;
          sessions.set(id, transport);
          sessionLastSeen.set(id, Date.now());
          transport.onclose = () => {
            if (storedId) {
              sessions.delete(storedId);
              sessionLastSeen.delete(storedId);
              sessionChains.delete(storedId);
              void browserManager.closeSession(storedId);
            }
          };
        },
      });

      const server = createMCPServer();
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: String(err) });
      }
    }
  });

  app.listen(port, () => {
    process.stderr.write(`human-browser MCP server running on HTTP :${port}/mcp\n`);
    process.stderr.write(`OAuth discovery: ${issuer}/.well-known/oauth-authorization-server\n`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Global safety net: never let a rejected promise or stray error kill the
// process. Playwright throws "Execution context was destroyed" when JS is
// evaluated during a navigation; that must not crash the whole MCP server
// (a crash restarts the container and wipes OAuth tokens in memory).
// ─────────────────────────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[unhandledRejection] ${reason instanceof Error ? reason.stack : String(reason)}\n`);
});
process.on('uncaughtException', (err) => {
  process.stderr.write(`[uncaughtException] ${err instanceof Error ? err.stack : String(err)}\n`);
});

async function main(): Promise<void> {
  const mode = process.env.MCP_TRANSPORT ?? 'stdio';
  if (mode === 'http') {
    await startHttp();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
