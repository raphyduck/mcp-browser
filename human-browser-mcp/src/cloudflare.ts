// Contournement automatique du challenge manage Cloudflare via CapSolver.
// Tout se fait cote serveur MCP : aucune intervention SSH n'est requise a l'usage.
//
// Pre-requis (variables d'env du conteneur) :
//   CAPSOLVER_API_KEY  : cle CapSolver
//   RELAY_PUBLIC       : host:port PUBLIC du relais gost (ex: 1.2.3.4:8899)
//   PROXY_USERNAME     : user du relais (auth -L de gost)
//   PROXY_PASSWORD     : pass du relais
// Le navigateur ET CapSolver sortent par ce meme relais => meme IP => cf_clearance valide.
import type { Page } from 'playwright';

const CF_MARKERS = [
  'Un instant',
  'Vérification de sécurité',
  'Verifying you are human',
  'Just a moment',
  'cf-browser-verification',
  'challenge-platform',
];

/** Detecte la page de challenge Cloudflare (interstitiel "Un instant..."). */
export async function isCloudflareChallenge(page: Page): Promise<boolean> {
  try {
    const title = (await page.title().catch(() => '')) || '';
    if (/un instant|just a moment/i.test(title)) return true;
    const txt = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 500) : '').catch(() => '');
    return CF_MARKERS.some((m) => txt.includes(m));
  } catch {
    return false;
  }
}

/** Domaine enregistrable (ex: app.pennylane.com -> pennylane.com). */
function registrableDomain(hostname: string): string {
  const parts = hostname.split('.');
  return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
}

async function capsolverSolve(websiteURL: string, userAgent: string, html?: string): Promise<string | null> {
  const key = process.env.CAPSOLVER_API_KEY;
  const relay = process.env.RELAY_PUBLIC;
  const u = process.env.PROXY_USERNAME;
  const p = process.env.PROXY_PASSWORD;
  if (!key || !relay || !u || !p) return null;
  const proxy = `http://${u}:${p}@${relay}`;
  const create: any = await fetch('https://api.capsolver.com/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: key,
      task: { type: 'AntiCloudflareTask', websiteURL, proxy, userAgent, ...(html ? { html } : {}) },
    }),
  }).then((r) => r.json());
  const taskId = create && create.taskId;
  if (!taskId) return null;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const res: any = await fetch('https://api.capsolver.com/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: key, taskId }),
    }).then((r) => r.json());
    if (res && res.status === 'ready') {
      const s = res.solution || {};
      return s.token || (s.cookies && s.cookies.cf_clearance) || null;
    }
    if (res && res.status === 'failed') return null;
  }
  return null;
}

/** Injecte le cf_clearance en cookie partitionne top-level (CHIPS) via CDP. */
async function injectClearance(page: Page, hostname: string, value: string) {
  const reg = registrableDomain(hostname);
  const topLevel = `https://${reg}`;
  const client = await page.context().newCDPSession(page);
  // Chrome recent : partitionKey est un objet {topLevelSite, hasCrossSiteAncestor}.
  try {
    await client.send('Network.setCookie', {
      name: 'cf_clearance', value, domain: `.${reg}`, path: '/',
      secure: true, httpOnly: true, sameSite: 'None',
      partitionKey: { topLevelSite: topLevel, hasCrossSiteAncestor: false } as any,
    } as any);
    return;
  } catch { /* fallback ancienne signature string */ }
  try {
    await client.send('Network.setCookie', {
      name: 'cf_clearance', value, domain: `.${reg}`, path: '/',
      secure: true, httpOnly: true, sameSite: 'None', partitionKey: topLevel as any,
    } as any);
  } catch {
    await page.context().addCookies([{ name: 'cf_clearance', value, domain: `.${reg}`, path: '/', secure: true, httpOnly: true, sameSite: 'None' } as any]);
  }
}

/**
 * Si la page courante est un challenge Cloudflare, le resout (CapSolver) et
 * recharge. Retourne true si un challenge a ete traite (passe ou tente).
 */
export async function solveCloudflare(page: Page, targetUrl?: string): Promise<{ solved: boolean; note: string }> {
  const url = targetUrl || page.url();
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => '');
  const html = await page.content().catch(() => undefined);
  const cf = await capsolverSolve(url, ua, html);
  if (!cf) return { solved: false, note: 'CapSolver: pas de cf_clearance (echec ou config manquante)' };
  const hostname = new URL(url).hostname;
  await injectClearance(page, hostname, cf);
  await page.reload({ waitUntil: 'load', timeout: 30000 }).catch(() => {});
  const still = await isCloudflareChallenge(page);
  return { solved: !still, note: still ? 'cf_clearance injecte mais challenge persistant' : 'challenge Cloudflare franchi' };
}
