import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { BrowserContext, Page } from 'playwright';
import { createCursor } from 'ghost-cursor-playwright';
type GhostCursor = ReturnType<typeof createCursor>;
import * as path from 'path';
import * as fs from 'fs';

chromium.use(StealthPlugin());

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const INIT_SCRIPT = `
(function () {
  // WebGL vendor / renderer spoofing
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

  // Navigator languages
  Object.defineProperty(navigator, 'languages', {
    get: () => ['fr-FR', 'fr', 'en-US', 'en'],
  });

  // Navigator plugins (simulate Chrome)
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ];
  Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
  Object.defineProperty(navigator, 'mimeTypes', { get: () => [] });

  // chrome runtime stub
  if (!window.chrome) {
    window.chrome = {
      app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', INSTALL: 'install', SHARED_MODULE_UPDATE: 'shared_module_update', UPDATE: 'update' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', GC_PRESSURE: 'gc_pressure', OS_UPDATE: 'os_update' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' },
      },
      csi: () => {},
      loadTimes: () => {},
    };
  }

  // hardware concurrency & device memory
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
})();
`;

class BrowserManager {
  private static instance: BrowserManager;
  private context: BrowserContext | null = null;
  private _page: Page | null = null;
  private cursor: GhostCursor | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getPage(): Promise<Page> {
    if (!this.context || !this._page) {
      await this.init();
    }
    return this._page!;
  }

  async getCursor(): Promise<GhostCursor> {
    const page = await this.getPage();
    if (!this.cursor) {
      this.cursor = createCursor(page);
    }
    return this.cursor;
  }

  /** Call after navigation so cursor is re-attached to the (possibly new) page */
  resetCursor(): void {
    this.cursor = null;
  }

  private async init(): Promise<void> {
    const profileDir = path.resolve(process.cwd(), 'profile');
    fs.mkdirSync(profileDir, { recursive: true });

    const headless = process.env.HEADLESS !== 'false';
    const slowMo = parseInt(process.env.SLOW_MO ?? '0', 10);
    const timeout = parseInt(process.env.BROWSER_TIMEOUT ?? '30000', 10);

    this.context = await (chromium as any).launchPersistentContext(profileDir, {
      headless,
      slowMo,
      viewport: { width: 1920, height: 1080 },
      userAgent: USER_AGENT,
      locale: 'fr-FR',
      timezoneId: 'Europe/Paris',
      geolocation: { latitude: 48.8566, longitude: 2.3522 },
      permissions: ['geolocation'],
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--lang=fr-FR',
      ],
    });

    this.context.setDefaultTimeout(timeout);

    // Inject stealth patches on every new page / frame
    await this.context.addInitScript(INIT_SCRIPT);

    const pages = this.context.pages();
    this._page = pages.length > 0 ? pages[0] : await this.context.newPage();

    // Re-create cursor when page is replaced
    this._page.on('framenavigated', () => this.resetCursor());
  }

  async close(): Promise<void> {
    await this.context?.close();
    this.context = null;
    this._page = null;
    this.cursor = null;
  }

  getContext(): BrowserContext | null {
    return this.context;
  }
}

export const browserManager = BrowserManager.getInstance();
