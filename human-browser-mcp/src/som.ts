// ─────────────────────────────────────────────────────────────────────────────
// Set-of-marks: stamp interactive elements with data-som-id and draw a numbered
// overlay. Designed to run once per frame via frame.evaluate(markFrame, opts).
//
// The function is self-contained (no external refs) so it serialises cleanly to
// the page context. It accepts a startId offset so ids stay unique across
// frames, and returns the marked items plus the last id used.
// ─────────────────────────────────────────────────────────────────────────────

export interface MarkOptions {
  startId: number;
  viewportOnly: boolean;
  maxElements: number;
}

export interface MarkedItem {
  id: number;
  tag: string;
  type: string | null;
  text: string;
}

export interface FrameMarkResult {
  items: MarkedItem[];
  lastId: number;
}

/**
 * Evaluated inside a frame. Stamps elements, draws the overlay, returns items.
 * The visual overlay is removed later via clearOverlay; data-som-id attributes
 * are kept so subsequent clicks resolve.
 */
export function markFrame(opts: MarkOptions): FrameMarkResult {
  // Clean any previous marks in this frame first.
  document.querySelectorAll('.__som_overlay').forEach((el) => el.remove());
  document
    .querySelectorAll('[data-som-id]')
    .forEach((el) => el.removeAttribute('data-som-id'));

  const SELECTOR = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="switch"]',
    '[contenteditable="true"]',
    '[onclick]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  const inViewport = (r: DOMRect): boolean =>
    !(r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth);

  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false;
    if (opts.viewportOnly && !inViewport(r)) return false;
    return true;
  };

  const layer = document.createElement('div');
  layer.className = '__som_overlay';
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  document.body.appendChild(layer);

  const items: MarkedItem[] = [];
  let id = opts.startId;

  const candidates = Array.from(document.querySelectorAll(SELECTOR));
  for (const el of candidates) {
    if (items.length >= opts.maxElements) break;
    if (!isVisible(el)) continue;
    id++;
    el.setAttribute('data-som-id', String(id));
    const r = el.getBoundingClientRect();

    const box = document.createElement('div');
    box.style.cssText =
      `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
      'border:2px solid #ff007f;box-sizing:border-box;pointer-events:none;';

    const tag = document.createElement('div');
    tag.textContent = String(id);
    tag.style.cssText =
      `position:fixed;left:${r.left}px;top:${Math.max(0, r.top - 16)}px;` +
      'background:#ff007f;color:#fff;font:bold 12px monospace;padding:0 4px;line-height:16px;pointer-events:none;';

    layer.append(box, tag);

    const anyEl = el as HTMLElement & { value?: string };
    items.push({
      id,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type'),
      text: (
        anyEl.innerText ||
        anyEl.value ||
        el.getAttribute('aria-label') ||
        el.getAttribute('placeholder') ||
        ''
      )
        .trim()
        .slice(0, 80),
    });
  }

  return { items, lastId: id };
}

/** Evaluated inside a frame to remove only the visual overlay. */
export function clearOverlay(): void {
  document.querySelectorAll('.__som_overlay').forEach((el) => el.remove());
}
