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

// Telemetrie Chrome : ces hotes n'ont aucun besoin d'une IP residentielle et
// representaient ~79% des requetes du relais (canal push GCM, Safe Browsing,
// mises a jour de composants). Les sortir du proxy supprime la conso au repos.
// NB: accounts.google.com et www.google.com sont VOLONTAIREMENT absents (usage reel).
const PROXY_BYPASS_DEFAULT = [
  'mtalk.google.com',
  'clients1.google.com',
  'clients2.google.com',
  'android.clients.google.com',
  'update.googleapis.com',
  'safebrowsing.googleapis.com',
  'safebrowsingohttpgateway.googleapis.com',
  'content-autofill.googleapis.com',
  'optimizationguide-pa.googleapis.com',
  'clientservices.googleapis.com',
  '.gvt1.com',
  '.gvt2.com',
].join(',');

// uBlock Origin Lite (MV3) est installe par POLICY entreprise
// (/etc/opt/chrome/policies/managed/ubol.json), pas par --load-extension :
// Chrome >=150 ignore ce commutateur. Ne bloque que les requetes des pages,
// jamais le trafic interne de Chrome (cf. PROXY_BYPASS_DEFAULT).

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
    // Contexte encore vivant ? (un crash de Chrome ferme le contexte : browser() devient
    // null ou deconnecte). Si mort, on reinitialise au lieu de renvoyer un contexte inutilisable.
    if (this.context) {
      const br = this.context.browser();
      if (br && br.isConnected()) return;
      // contexte mort -> reset pour forcer une nouvelle init
      this.context = null;
      this.initPromise = null;
      this.pages.clear();
      this.cursors.clear();
      this.lastUsed.clear();
      this.freePages = [];
    }
    if (!this.initPromise) this.initPromise = this.init();
    try {
      await this.initPromise;
    } catch (e) {
      // init ratee : ne pas cacher une promesse rejetee (sinon on rejoue l'erreur a vie)
      this.initPromise = null;
      throw e;
    }
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
      ? { proxy: { server: proxyServer, username: process.env.PROXY_USERNAME, password: process.env.PROXY_PASSWORD, bypass: process.env.PROXY_BYPASS ?? PROXY_BYPASS_DEFAULT } }
      : {};

    this.context = await (chromium as any).launchPersistentContext(profileDir, {
      ...proxyOpt,
      // Playwright passe --disable-background-networking par defaut, ce qui desactive
      // aussi l'updater d'extensions : une extension force-installee par policy n'est
      // alors JAMAIS telechargee. Le trafic de fond est deja coupe par les policies
      // (metrics, safebrowsing, component updates, signin) et par PROXY_BYPASS_DEFAULT.
      ignoreDefaultArgs: ['--disable-background-networking'],
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
        // Trafic de fond de Chrome : coupe a la source ce que le bypass ne fait que devier.
        '--disable-component-update',
        '--disable-domain-reliability',
        '--disable-sync',
        '--disable-breakpad',
        '--no-pings',
        '--disable-client-side-phishing-detection',
      ],
    });

    this.context!.setDefaultTimeout(timeout);
    await this.context!.addInitScript(INIT_SCRIPT);

    // Auto-reset si le contexte se ferme (crash Chrome, disconnect) : la prochaine
    // action relancera une init propre au lieu de rester bloquee sur un contexte mort.
    this.context!.on('close', () => {
      this.context = null;
      this.initPromise = null;
      this.pages.clear();
      this.cursors.clear();
      this.lastUsed.clear();
      this.freePages = [];
    });

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
