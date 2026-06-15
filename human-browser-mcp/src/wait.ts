import type { Page } from 'playwright';

/**
 * Wait until the DOM has been quiet for `settleMs` (no mutations), hard-capped
 * at `capMs`. Runs a MutationObserver inside the page; resolves early on cap so
 * it can never hang. Safe on navigation: if the execution context is destroyed
 * mid-wait, the rejection is swallowed and we return.
 */
export async function waitForSettle(page: Page, settleMs: number, capMs: number): Promise<void> {
  try {
    await page.evaluate(
      ({ settle, cap }) =>
        new Promise<void>((resolve) => {
          let quietTimer: ReturnType<typeof setTimeout>;
          const finish = () => {
            clearTimeout(quietTimer);
            clearTimeout(capTimer);
            try {
              observer.disconnect();
            } catch {
              /* ignore */
            }
            resolve();
          };
          const observer = new MutationObserver(() => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(finish, settle);
          });
          observer.observe(document, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          quietTimer = setTimeout(finish, settle);
          const capTimer = setTimeout(finish, cap);
        }),
      { settle: settleMs, cap: capMs }
    );
  } catch {
    // Execution context destroyed (navigation) or evaluate failed — treat as settled.
  }
}
