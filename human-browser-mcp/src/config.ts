// ─────────────────────────────────────────────────────────────────────────────
// Centralised configuration for timeouts and human/stabilisation delays.
// All values overridable via environment variables so behaviour can be tuned
// without touching individual tools.
// ─────────────────────────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Default timeout for selector waits / navigation (ms). */
  defaultTimeout: intEnv('BROWSER_TIMEOUT', 30_000),

  /** Default DOM-settle window after navigation: no mutations for this long. */
  navigateSettleMs: intEnv('NAVIGATE_SETTLE_MS', 500),

  /** Hard cap on the navigation settle wait (ms). */
  navigateSettleCapMs: intEnv('NAVIGATE_SETTLE_CAP_MS', 3_000),

  /** Default DOM-settle window after a click that may trigger a re-render. */
  clickSettleMs: intEnv('CLICK_SETTLE_MS', 300),

  /** Hard cap on the click settle wait (ms). */
  clickSettleCapMs: intEnv('CLICK_SETTLE_CAP_MS', 3_000),

  /** Max elements marked by browser_mark_page. */
  markMaxElements: intEnv('MARK_MAX_ELEMENTS', 200),
} as const;
