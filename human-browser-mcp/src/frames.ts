import type { Page, Frame, Locator } from 'playwright';
import { ActionError } from './errors.js';

export interface ResolvedTarget {
  frame: Frame;
  label: string;
  isMain: boolean;
  locator: Locator;
}

interface FrameCandidate {
  frame: Frame;
  label: string;
  isMain: boolean;
}

function labelFor(page: Page, frame: Frame, index: number): string {
  if (frame === page.mainFrame()) return 'main';
  return frame.name() || frame.url() || `frame-${index}`;
}

/** Resolve a frame hint (name | url substring | numeric index) to a frame. */
function findFrameByHint(page: Page, hint: string): FrameCandidate | null {
  const frames = page.frames();
  if (/^\d+$/.test(hint)) {
    const i = parseInt(hint, 10);
    if (frames[i]) return { frame: frames[i], label: labelFor(page, frames[i], i), isMain: frames[i] === page.mainFrame() };
    return null;
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.name() === hint || f.url() === hint || (hint && f.url().includes(hint))) {
      return { frame: f, label: labelFor(page, f, i), isMain: f === page.mainFrame() };
    }
  }
  return null;
}

async function firstFrameWithMatch(
  candidates: FrameCandidate[],
  selector: string
): Promise<FrameCandidate | null> {
  for (const c of candidates) {
    try {
      if ((await c.frame.locator(selector).count()) > 0) return c;
    } catch {
      // inaccessible/cross-origin frame — skip
    }
  }
  return null;
}

/**
 * Resolve a selector to a concrete (frame, locator), trying the main frame
 * first then each child frame (open shadow roots are pierced natively by
 * Playwright's CSS engine). Preserves auto-wait for late-rendered elements and
 * raises precise ActionError codes.
 *
 * @param opts.frame optional hint to target a specific frame (name|url|index)
 */
export async function resolveTarget(
  page: Page,
  selector: string,
  opts: { frame?: string; timeout: number; unique?: boolean; visible?: boolean }
): Promise<ResolvedTarget> {
  let candidates: FrameCandidate[];
  if (opts.frame !== undefined && opts.frame !== '') {
    const hit = findFrameByHint(page, opts.frame);
    if (!hit) {
      throw new ActionError('FRAME_NOT_FOUND', `No frame matches "${opts.frame}"`, { frame: opts.frame });
    }
    candidates = [hit];
  } else {
    candidates = page.frames().map((f, i) => ({
      frame: f,
      label: labelFor(page, f, i),
      isMain: f === page.mainFrame(),
    }));
  }

  // Quick scan, then allow late render by waiting on the first candidate.
  let chosen = await firstFrameWithMatch(candidates, selector);
  if (!chosen) {
    try {
      await candidates[0].frame.locator(selector).first().waitFor({ state: 'attached', timeout: opts.timeout });
    } catch {
      /* nothing appeared */
    }
    chosen = await firstFrameWithMatch(candidates, selector);
  }
  if (!chosen) {
    throw new ActionError('NOT_FOUND', `No element matches "${selector}"`, {
      selector,
      ...(opts.frame ? { frame: opts.frame } : {}),
    });
  }

  const locator = chosen.frame.locator(selector);

  if (opts.unique) {
    const count = await locator.count();
    if (count > 1) {
      const cand: string[] = [];
      for (let i = 0; i < Math.min(count, 5); i++) {
        try {
          const t = (await locator.nth(i).innerText({ timeout: 500 })).trim().slice(0, 60);
          cand.push(t || `<${await locator.nth(i).evaluate((e) => e.tagName.toLowerCase())}>`);
        } catch {
          /* skip */
        }
      }
      throw new ActionError(
        'MULTIPLE_MATCHES',
        `${count} elements match "${selector}". Refine the selector or use data-som-id.`,
        { selector, count, candidates: cand, frame: chosen.label }
      );
    }
  }

  if (opts.visible) {
    if (!(await locator.first().isVisible())) {
      throw new ActionError('NOT_VISIBLE', `Element "${selector}" is present but not visible`, {
        selector,
        frame: chosen.label,
      });
    }
  }

  return { frame: chosen.frame, label: chosen.label, isMain: chosen.isMain, locator };
}
