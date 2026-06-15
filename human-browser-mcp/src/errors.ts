import type { Page } from 'playwright';

export type ErrorCode =
  | 'NOT_FOUND'
  | 'MULTIPLE_MATCHES'
  | 'NOT_VISIBLE'
  | 'INTERCEPTED'
  | 'DETACHED'
  | 'TIMEOUT'
  | 'FRAME_NOT_FOUND'
  | 'UNKNOWN';

/** Error carrying a stable code + structured details for the MCP response. */
export class ActionError extends Error {
  code: ErrorCode;
  details: Record<string, unknown>;
  constructor(code: ErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
    this.details = details;
  }
}

interface Classified {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

/** Map any thrown error to a stable code + details. */
export function classifyError(err: unknown): Classified {
  if (err instanceof ActionError) {
    return { code: err.code, message: err.message, details: err.details };
  }
  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';

  if (name === 'TimeoutError' || /Timeout.*exceeded|exceeded.*timeout/i.test(message)) {
    const m = message.match(/(\d+)\s*ms/);
    return {
      code: 'TIMEOUT',
      message,
      details: m ? { timeout_ms: parseInt(m[1], 10) } : {},
    };
  }
  if (/intercepts pointer events|intercept the pointer/i.test(message)) {
    return { code: 'INTERCEPTED', message, details: {} };
  }
  if (/detached|not attached|Node is detached|element is not attached/i.test(message)) {
    return { code: 'DETACHED', message, details: {} };
  }
  if (/frame (was )?(not found|detached)|no frame|frame got detached/i.test(message)) {
    return { code: 'FRAME_NOT_FOUND', message, details: {} };
  }
  return { code: 'UNKNOWN', message, details: {} };
}

/**
 * Resolve a selector to a precise error code before acting. Preserves auto-wait
 * (waits for the element to attach, so late-rendered elements still work), then
 * distinguishes NOT_FOUND / MULTIPLE_MATCHES / NOT_VISIBLE.
 */
export async function precheckSelector(
  page: Page,
  selector: string,
  opts: { unique?: boolean; visible?: boolean; timeout: number }
): Promise<void> {
  const loc = page.locator(selector);

  // Wait for at least one match to attach; if none ever appears → NOT_FOUND.
  try {
    await loc.first().waitFor({ state: 'attached', timeout: opts.timeout });
  } catch {
    throw new ActionError('NOT_FOUND', `No element matches "${selector}"`, { selector });
  }

  if (opts.unique) {
    const count = await loc.count();
    if (count > 1) {
      const candidates: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        try {
          const t = (await loc.nth(i).innerText({ timeout: 500 })).trim().slice(0, 60);
          candidates.push(t || `<${(await loc.nth(i).evaluate((e) => e.tagName.toLowerCase()))}>`);
        } catch {
          /* skip unreadable candidate */
        }
      }
      throw new ActionError(
        'MULTIPLE_MATCHES',
        `${count} elements match "${selector}". Refine the selector or use data-som-id.`,
        { selector, count, candidates }
      );
    }
  }

  if (opts.visible) {
    const visible = await loc.first().isVisible();
    if (!visible) {
      throw new ActionError('NOT_VISIBLE', `Element "${selector}" is present but not visible`, {
        selector,
      });
    }
  }
}
