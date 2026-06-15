// ─────────────────────────────────────────────────────────────────────────────
// Deterministic test runner: exercises each MCP tool against the local fixture.
// Run with:  npm run build && node test/run.mjs
// Requires Chromium installed (npx playwright install chromium).
// ─────────────────────────────────────────────────────────────────────────────

process.env.HEADLESS = process.env.HEADLESS ?? 'true';
process.env.BROWSER_TIMEOUT = process.env.BROWSER_TIMEOUT ?? '15000';

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureUrl = 'file://' + join(here, 'fixture.html');

const actions = await import('../dist/actions.js');
const { browserManager } = await import('../dist/browser.js');

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL  ${name}  ${extra}`);
  }
}

/** Extract the parsed JSON text block from a tool response, if any. */
function json(res) {
  const block = res.content.find((c) => c.type === 'text');
  try {
    return JSON.parse(block.text);
  } catch {
    return { __raw: block?.text };
  }
}

function hasImage(res) {
  return res.content.some((c) => c.type === 'image' && c.data);
}

async function readMainValue(selector) {
  const page = await browserManager.getPage();
  return page.evaluate((s) => document.querySelector(s)?.value ?? null, selector);
}

async function readFrameValue(frameName, selector) {
  const page = await browserManager.getPage();
  const frame = page.frames().find((f) => f.name() === frameName);
  if (!frame) return null;
  return frame.evaluate((s) => document.querySelector(s)?.value ?? null, selector);
}

async function readShadowValue() {
  const page = await browserManager.getPage();
  return page.evaluate(() => {
    const host = document.querySelector('my-widget');
    return host?.shadowRoot?.querySelector('#shadow-input')?.value ?? null;
  });
}

try {
  // ── Navigation + structured state (T2, T3) ─────────────────────────────────
  const nav = await actions.browserNavigate({ url: fixtureUrl });
  const navState = json(nav);
  ok('navigate returns ok+url', navState.ok === true && navState.url.includes('fixture.html'), JSON.stringify(navState));

  // ── T1: mark_page ──────────────────────────────────────────────────────────
  const mark = await actions.browserMarkPage({});
  const markMap = json(mark);
  ok('mark_page returns an image block', hasImage(mark));
  ok('mark_page returns elements map', markMap.count > 0 && Array.isArray(markMap.elements), JSON.stringify(markMap).slice(0, 120));
  ok(
    'mark_page ids are unique',
    new Set(markMap.elements.map((e) => e.id)).size === markMap.elements.length
  );
  const emailMark = markMap.elements.find((e) => e.tag === 'input' && e.type === 'email');
  ok('mark_page captured the email input', !!emailMark);

  // ── T2: auto-wait picks up the async button (appears at 800ms) ─────────────
  const asyncClick = await actions.browserClick({ selector: '#async-btn' });
  const asyncState = json(asyncClick);
  ok('click async button ok', asyncState.ok === true, JSON.stringify(asyncState));
  ok('async button handler ran', (await browserManager.getPage().then((p) => p.textContent('#async-btn'))) === 'Async clicked');

  // ── T3: type + select structured state ─────────────────────────────────────
  const typed = await actions.browserType({ selector: '#email', text: 'a@b.com' });
  ok('type returns ok', json(typed).ok === true);
  ok('type wrote the value', (await readMainValue('#email')) === 'a@b.com');

  const selected = await actions.browserSelect({ selector: '#country', value: 'fr' });
  ok('select returns ok', json(selected).ok === true);
  ok('select set the value', (await readMainValue('#country')) === 'fr');

  // ── T4: structured errors ──────────────────────────────────────────────────
  const notFound = json(await actions.browserClick({ selector: '#does-not-exist' }));
  ok('NOT_FOUND code', notFound.ok === false && notFound.error.code === 'NOT_FOUND', JSON.stringify(notFound));

  const multi = json(await actions.browserClick({ selector: '.dup' }));
  ok(
    'MULTIPLE_MATCHES code + count + candidates',
    multi.ok === false &&
      multi.error.code === 'MULTIPLE_MATCHES' &&
      multi.error.count === 3 &&
      Array.isArray(multi.error.candidates) &&
      multi.error.candidates.includes('Valider'),
    JSON.stringify(multi)
  );

  const badFrame = json(await actions.browserClick({ selector: '#x', frame: 'no-such-frame' }));
  ok('FRAME_NOT_FOUND code', badFrame.ok === false && badFrame.error.code === 'FRAME_NOT_FOUND', JSON.stringify(badFrame));

  // ── T5: iframe ─────────────────────────────────────────────────────────────
  const iframeType = json(await actions.browserClearAndType({ selector: '#iframe-input', text: 'in-frame' }));
  ok('iframe type ok (auto frame detection)', iframeType.ok === true, JSON.stringify(iframeType));
  ok('iframe field received value', (await readFrameValue('inner', '#iframe-input')) === 'in-frame');

  const iframeClick = json(await actions.browserClick({ selector: '#iframe-btn', frame: 'inner' }));
  ok('iframe click ok (explicit frame hint)', iframeClick.ok === true, JSON.stringify(iframeClick));

  // ── T5: open shadow DOM ────────────────────────────────────────────────────
  const shadowType = json(await actions.browserClearAndType({ selector: '#shadow-input', text: 'shadow-val' }));
  ok('shadow type ok', shadowType.ok === true, JSON.stringify(shadowType));
  ok('shadow input received value', (await readShadowValue()) === 'shadow-val');
} catch (err) {
  fail++;
  failures.push('UNCAUGHT: ' + (err?.stack || err));
  console.log('  FAIL  uncaught exception\n', err);
} finally {
  await browserManager.close();
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('Failures:', failures.join(', '));
  process.exit(1);
}
