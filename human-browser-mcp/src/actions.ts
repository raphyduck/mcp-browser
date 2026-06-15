import type { Frame } from 'playwright';
import { browserManager } from './browser.js';
import { humanDelay, typingDelay, randomPause, sleep, scrollChunk } from './utils.js';
import { config } from './config.js';
import { markFrame, clearOverlay, MarkedItem } from './som.js';
import { waitForSettle } from './wait.js';

const DEFAULT_TIMEOUT = config.defaultTimeout;

/** Stable label for a frame, used in mark_page output. */
function frameLabel(frame: Frame, isMain: boolean, index: number): string {
  if (isMain) return 'main';
  return frame.name() || frame.url() || `frame-${index}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function withErrorScreenshot<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    try {
      const page = await browserManager.getPage();
      const shot = await page.screenshot({ type: 'png', fullPage: false });
      const b64 = shot.toString('base64');
      (err as any).__screenshot = b64;
    } catch {
      // ignore screenshot errors
    }
    throw err;
  }
}

function makeErrorResponse(err: unknown): { content: { type: string; text: string }[]; __screenshot?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const response: any = {
    content: [{ type: 'text', text: `Error: ${message}` }],
  };
  if ((err as any).__screenshot) {
    response.content.push({ type: 'image', data: (err as any).__screenshot, mimeType: 'image/png' });
  }
  return response;
}

// ─────────────────────────────────────────────────────────────────────────────
// Navigation
// ─────────────────────────────────────────────────────────────────────────────

export async function browserNavigate(args: {
  url: string;
  waitUntil?: 'domcontentloaded' | 'load' | 'networkidle' | 'none';
  settle_ms?: number;
}) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const mode = args.waitUntil ?? 'domcontentloaded';

    // 'none' → return as soon as navigation commits, no load-state or settle wait.
    // networkidle stays opt-in only: on sites with websockets/long-polling/
    // analytics it may never fire and the call would hang.
    const gotoWaitUntil = mode === 'none' ? 'commit' : mode;
    await page.goto(args.url, { waitUntil: gotoWaitUntil as any, timeout: DEFAULT_TIMEOUT });
    browserManager.resetCursor();

    if (mode !== 'none') {
      const settle = Math.min(args.settle_ms ?? config.navigateSettleMs, config.navigateSettleCapMs);
      await waitForSettle(page, settle, config.navigateSettleCapMs);
    }

    await humanDelay();
    return { content: [{ type: 'text', text: `Navigated to ${page.url()}` }] };
  }).catch(makeErrorResponse);
}

export async function browserBack(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.goBack({ timeout: DEFAULT_TIMEOUT });
    browserManager.resetCursor();
    await humanDelay();
    return { content: [{ type: 'text', text: `Went back to ${page.url()}` }] };
  }).catch(makeErrorResponse);
}

export async function browserForward(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.goForward({ timeout: DEFAULT_TIMEOUT });
    browserManager.resetCursor();
    await humanDelay();
    return { content: [{ type: 'text', text: `Went forward to ${page.url()}` }] };
  }).catch(makeErrorResponse);
}

export async function browserRefresh(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.reload({ timeout: DEFAULT_TIMEOUT });
    browserManager.resetCursor();
    await humanDelay();
    return { content: [{ type: 'text', text: `Refreshed ${page.url()}` }] };
  }).catch(makeErrorResponse);
}

export async function browserGetUrl(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    return { content: [{ type: 'text', text: page.url() }] };
  }).catch(makeErrorResponse);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

export async function browserGetContent(args: { selector?: string }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    let text: string;
    if (args.selector) {
      const el = page.locator(args.selector).first();
      text = await el.innerText({ timeout: DEFAULT_TIMEOUT });
    } else {
      text = await page.evaluate(() => document.body.innerText);
    }
    return { content: [{ type: 'text', text }] };
  }).catch(makeErrorResponse);
}

export async function browserScreenshot(args: { selector?: string; fullPage?: boolean }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    let buffer: Buffer;
    if (args.selector) {
      const el = page.locator(args.selector).first();
      buffer = await el.screenshot({ type: 'png' });
    } else {
      buffer = await page.screenshot({ type: 'png', fullPage: args.fullPage ?? false });
    }
    const data = buffer.toString('base64');
    return { content: [{ type: 'image', data, mimeType: 'image/png' }] };
  }).catch(makeErrorResponse);
}

export async function browserMarkPage(args: { viewport_only?: boolean; max_elements?: number }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const viewportOnly = args.viewport_only ?? true;
    const maxElements = args.max_elements ?? config.markMaxElements;

    const frames = page.frames();
    const marked: (MarkedItem & { frame: string })[] = [];
    let startId = 0;

    // Mark the main frame first, then each child frame, keeping ids globally
    // unique by carrying the running id offset across frames.
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const isMain = frame === page.mainFrame();
      const label = frameLabel(frame, isMain, i);
      const remaining = maxElements - marked.length;
      if (remaining <= 0) break;
      try {
        const result = await frame.evaluate(markFrame, {
          startId,
          viewportOnly,
          maxElements: remaining,
        });
        for (const item of result.items) {
          marked.push({ ...item, frame: label });
        }
        startId = result.lastId;
      } catch {
        // Cross-origin / inaccessible frame — skip it silently.
      }
    }

    // Screenshot the viewport WITH the overlay visible.
    const buffer = await page.screenshot({ type: 'png', fullPage: false });
    const data = buffer.toString('base64');

    // Remove only the visual overlay; keep data-som-id attributes intact.
    for (const frame of frames) {
      try {
        await frame.evaluate(clearOverlay);
      } catch {
        // ignore
      }
    }

    const map = {
      count: marked.length,
      elements: marked.map((m) => ({
        id: m.id,
        tag: m.tag,
        type: m.type,
        text: m.text,
        frame: m.frame,
      })),
    };

    return {
      content: [
        { type: 'image', data, mimeType: 'image/png' },
        { type: 'text', text: JSON.stringify(map) },
      ],
    };
  }).catch(makeErrorResponse);
}

export async function browserWaitFor(args: { selector: string; timeout?: number; state?: string }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const timeout = args.timeout ?? DEFAULT_TIMEOUT;
    const state = (args.state ?? 'visible') as 'attached' | 'detached' | 'visible' | 'hidden';
    await page.waitForSelector(args.selector, { timeout, state });
    return { content: [{ type: 'text', text: `Selector "${args.selector}" is ${state}` }] };
  }).catch(makeErrorResponse);
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactions
// ─────────────────────────────────────────────────────────────────────────────

export async function browserClick(args: { selector: string; button?: string; settle_ms?: number }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.waitForSelector(args.selector, { timeout: DEFAULT_TIMEOUT, state: 'visible' });

    const cursor = await browserManager.getCursor();
    await cursor.actions.move({ targetElem: args.selector });
    await cursor.actions.click();

    // Post-click settle: if the click triggers a SPA navigation or re-render,
    // wait for the DOM to go quiet (capped) instead of returning immediately.
    const settle = Math.min(args.settle_ms ?? config.clickSettleMs, config.clickSettleCapMs);
    await waitForSettle(page, settle, config.clickSettleCapMs);

    await humanDelay();
    return { content: [{ type: 'text', text: `Clicked "${args.selector}"` }] };
  }).catch(makeErrorResponse);
}

export async function browserType(args: { selector: string; text: string; clearFirst?: boolean }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.waitForSelector(args.selector, { timeout: DEFAULT_TIMEOUT, state: 'visible' });

    const cursor = await browserManager.getCursor();
    await cursor.actions.move({ targetElem: args.selector });
    await cursor.actions.click();
    await sleep(150 + Math.random() * 100);

    if (args.clearFirst) {
      await page.keyboard.down('Control');
      await page.keyboard.press('a');
      await page.keyboard.up('Control');
      await sleep(80);
    }

    for (const char of args.text) {
      await page.keyboard.type(char);
      await sleep(typingDelay());
      await randomPause();
    }

    await humanDelay();
    return { content: [{ type: 'text', text: `Typed ${args.text.length} characters into "${args.selector}"` }] };
  }).catch(makeErrorResponse);
}

export async function browserClearAndType(args: { selector: string; text: string }) {
  return browserType({ selector: args.selector, text: args.text, clearFirst: true });
}

export async function browserSelect(args: { selector: string; value: string }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.waitForSelector(args.selector, { timeout: DEFAULT_TIMEOUT, state: 'visible' });
    await page.selectOption(args.selector, args.value);
    await humanDelay();
    return { content: [{ type: 'text', text: `Selected "${args.value}" in "${args.selector}"` }] };
  }).catch(makeErrorResponse);
}

export async function browserHover(args: { selector: string }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    await page.waitForSelector(args.selector, { timeout: DEFAULT_TIMEOUT, state: 'visible' });
    const cursor = await browserManager.getCursor();
    await cursor.actions.move({ targetElem: args.selector });
    await humanDelay();
    return { content: [{ type: 'text', text: `Hovered over "${args.selector}"` }] };
  }).catch(makeErrorResponse);
}

export async function browserScroll(args: { deltaX?: number; deltaY?: number; selector?: string; steps?: number }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const deltaX = args.deltaX ?? 0;
    const deltaY = args.deltaY ?? 300;
    const steps = args.steps ?? Math.ceil(Math.abs(deltaY) / 80);

    if (args.selector) {
      await page.waitForSelector(args.selector, { timeout: DEFAULT_TIMEOUT });
      const el = page.locator(args.selector).first();
      await el.scrollIntoViewIfNeeded();
    }

    for (let i = 0; i < steps; i++) {
      const chunkY = scrollChunk(deltaY, steps, i);
      const chunkX = deltaX !== 0 ? scrollChunk(deltaX, steps, i) : 0;
      await page.mouse.wheel(chunkX, chunkY);
      await sleep(30 + Math.random() * 60);
    }

    await humanDelay();
    return { content: [{ type: 'text', text: `Scrolled (deltaX=${deltaX}, deltaY=${deltaY}) in ${steps} steps` }] };
  }).catch(makeErrorResponse);
}

export async function browserPressKey(args: { key: string; modifiers?: string[] }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const modifiers = args.modifiers ?? [];
    for (const mod of modifiers) await page.keyboard.down(mod);
    await page.keyboard.press(args.key);
    for (const mod of [...modifiers].reverse()) await page.keyboard.up(mod);
    await humanDelay();
    return { content: [{ type: 'text', text: `Pressed key "${args.key}"` }] };
  }).catch(makeErrorResponse);
}

export async function browserEvaluate(args: { script: string }) {
  return withErrorScreenshot(async () => {
    const page = await browserManager.getPage();
    const result = await page.evaluate(args.script);
    const text = result === undefined ? 'undefined' : JSON.stringify(result, null, 2);
    return { content: [{ type: 'text', text }] };
  }).catch(makeErrorResponse);
}

// ─────────────────────────────────────────────────────────────────────────────
// Session / Cookies
// ─────────────────────────────────────────────────────────────────────────────

export async function browserGetCookies(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const ctx = browserManager.getContext();
    if (!ctx) throw new Error('Browser not initialised');
    const cookies = await ctx.cookies();
    return { content: [{ type: 'text', text: JSON.stringify(cookies, null, 2) }] };
  }).catch(makeErrorResponse);
}

export async function browserSetCookies(args: { cookies: object[] }) {
  return withErrorScreenshot(async () => {
    const ctx = browserManager.getContext();
    if (!ctx) throw new Error('Browser not initialised');
    await ctx.addCookies(args.cookies as any);
    return { content: [{ type: 'text', text: `Set ${args.cookies.length} cookie(s)` }] };
  }).catch(makeErrorResponse);
}

export async function browserClearCookies(_args: Record<string, never>) {
  return withErrorScreenshot(async () => {
    const ctx = browserManager.getContext();
    if (!ctx) throw new Error('Browser not initialised');
    await ctx.clearCookies();
    return { content: [{ type: 'text', text: 'Cookies cleared' }] };
  }).catch(makeErrorResponse);
}

// ─────────────────────────────────────────────────────────────────────────────
// CapSolver (optional)
// ─────────────────────────────────────────────────────────────────────────────

export async function browserSolveCaptcha(args: { type?: string }) {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) {
    return { content: [{ type: 'text', text: 'CAPSOLVER_API_KEY is not set' }] };
  }

  return withErrorScreenshot(async () => {
    let Capsolver: any;
    try {
      // Dynamic import via a non-literal specifier so the build does not require
      // the optional package to be installed; the server still works without it.
      const pkg = '@capsolver/capsolver-npm';
      const mod: any = await import(pkg);
      Capsolver = mod.default ?? mod.Capsolver;
    } catch {
      return { content: [{ type: 'text', text: '@capsolver/capsolver-npm is not installed' }] };
    }

    const page = await browserManager.getPage();
    const url = page.url();
    const captchaType = args.type ?? 'auto';

    const capsolver = new Capsolver({ apiKey });
    const solution = await capsolver.solve({
      type: captchaType,
      websiteURL: url,
    });

    return { content: [{ type: 'text', text: `Captcha solved: ${JSON.stringify(solution)}` }] };
  }).catch(makeErrorResponse);
}
