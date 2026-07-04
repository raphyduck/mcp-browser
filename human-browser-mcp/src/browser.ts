import { chromium } from 'patchright';
import type { BrowserContext, Page } from 'playwright';
import { createCursor, Cursor } from 'ghost-cursor-playwright';
import { AsyncLocalStorage } from 'node:async_hooks';
import * as path from 'path';
import * as fs from 'fs';


// Carries the MCP sessionId down to getPage()/getCursor() without changing
// the (argument-less) call sites in actions.ts.
export const sessionStore = new AsyncLocalStorage<string>();
function currentSession(): string {
  // Le tabId est pose dans l'AsyncLocalStorage par runForSession (dispatch index.ts),
  // a partir du parametre `tab` fourni par l'appelant. Meme tab => meme onglet ;
  // absent => onglet 'default' partage. Cf. commentaire multi-session dans index.ts.
  return sessionStore.getStore() ?? 'default';
}

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36';

const INIT_SCRIPT = `
(function () {
  const getParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
    return getParameter.call(this, parameter);
  };
  const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function (parameter) {
    if (parameter === 37445) return 'Intel Inc.';
    if (parameter === 37446) return 'Intel(R) Iris(TM) Plus Graphics 640';
    return getParameter2.call(this, parameter);
  };
  Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ];
  Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
  Object.defineProperty(navigator, 'mimeTypes', { get: () => [] });
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false },
      runtime: {},
      csi: () => {},
      loadTimes: () => {},
    };
  }
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' });
})();
`;

class BrowserManager {
  private static instance: BrowserManager;
  private context: BrowserContext | null = null;
  private initPromise: Promise<void> | null = null;
  private pages = new Map<string, Page>();
  private cursors = new Map<string, Cursor>();
  private lastUsed = new Map<string, number>();
  private freePages: Page[] = [];

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  private async ensureContext(): Promise<void> {
    if (this.context) return;
    if (!this.initPromise) this.initPromise = this.init();
    await this.initPromise;
  }

  async getPage(): Promise<Page> {
    await this.ensureContext();
    const id = currentSession();
    let page = this.pages.get(id);
    if (!page || page.isClosed()) {
      page = this.freePages.shift() ?? (await this.context!.newPage());
      this.pages.set(id, page);
      this.cursors.delete(id);
      page.on('framenavigated', () => this.resetCursor(id));
      page.on('close', () => {
        this.pages.delete(id);
        this.cursors.delete(id);
        this.lastUsed.delete(id);
      });
    }
    this.lastUsed.set(id, Date.now());
    return page;
  }

  async getCursor(): Promise<Cursor> {
    const id = currentSession();
    const page = await this.getPage();
    let cursor = this.cursors.get(id);
    if (!cursor) {
      cursor = await createCursor(page);
      this.cursors.set(id, cursor);
    }
    return cursor;
  }

  resetCursor(id?: string): void {
    this.cursors.delete(id ?? currentSession());
  }

  async closeSession(id: string): Promise<void> {
    const page = this.pages.get(id);
    this.pages.delete(id);
    this.cursors.delete(id);
    this.lastUsed.delete(id);
    if (page && !page.isClosed()) {
      try { await page.close(); } catch { /* ignore */ }
    }
  }

  private async init(): Promise<void> {
    const profileDir = path.resolve(process.cwd(), 'profile');
    fs.mkdirSync(profileDir, { recursive: true });

    const headless = process.env.HEADLESS !== 'false';
    const slowMo = parseInt(process.env.SLOW_MO ?? '0', 10);
    const timeout = parseInt(process.env.BROWSER_TIMEOUT ?? '30000', 10);

    // Proxy residentiel (Webshare) : lu depuis l'env, absent => pas de proxy.
    const proxyServer = process.env.PROXY_SERVER;
    const proxyOpt = proxyServer
      ? { proxy: { server: proxyServer, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD } }
      : {};

    this.context = await (chromium as any).launchPersistentContext(profileDir, {
      ...proxyOpt,
      channel: 'chrome',
      headless,
      slowMo,
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      geolocation: { latitude: 48.8566, longitude: 2.3522 },
      permissions: ['geolocation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--lang=fr-FR',
        // WebGL logiciel (SwiftShader) : sans GPU sous Xvfb, Chromium desactive WebGL,
        // et 'pas de WebGL' est un signal bot fort. On force le rendu logiciel ;
        // le vendor/renderer est ensuite masque en Intel par INIT_SCRIPT.
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
      ],
    });

    this.context!.setDefaultTimeout(timeout);
    await this.context!.addInitScript(INIT_SCRIPT);

    // Reuse whatever blank page(s) the persistent context opened with.
    this.freePages = this.context!.pages();

    // Idle tab reaper: close pages unused beyond PAGE_IDLE_MS (default 15 min).
    const idleMs = parseInt(process.env.PAGE_IDLE_MS ?? '900000', 10);
    setInterval(() => {
      const now = Date.now();
      for (const [id, t] of this.lastUsed) {
        if (now - t > idleMs) void this.closeSession(id);
      }
    }, 60_000).unref();
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this.initPromise = null;
    this.pages.clear();
    this.cursors.clear();
    this.lastUsed.clear();
    this.freePages = [];
  }

  getContext(): BrowserContext | null {
    return this.context;
  }
}

export const browserManager = BrowserManager.getInstance();
