// ─────────────────────────────────────────────────────────────────────────────
// browser_upload_file : dépose un fichier dans un <input type="file"> de la
// page. Le fichier est d'abord matérialisé sur le disque du conteneur (dépôt
// partagé avec l'Imap MCP : /root/Downloads/imap-attachments/uploads), puis
// remis à Playwright via locator.setInputFiles.
//
// Trois sources possibles, exactement une à la fois :
//   - content_base64 : contenu fourni par le modèle (petits fichiers) ;
//   - url            : le serveur télécharge lui-même (pas de base64 côté modèle) ;
//   - path           : un fichier déjà présent dans le dépôt partagé (nom de
//                      fichier, ou chemin absolu sous /root/Downloads/imap-attachments).
// ─────────────────────────────────────────────────────────────────────────────

import { mkdirSync, readdirSync, statSync, unlinkSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { basename, join, resolve, sep } from 'path';
import { randomBytes } from 'crypto';
import { browserManager } from './browser.js';
import { humanDelay } from './utils.js';
import { config } from './config.js';
import { resolveTarget } from './frames.js';
import { ActionError, classifyError } from './errors.js';

const ATTACHMENTS_DIR = process.env.UPLOAD_ATTACHMENTS_DIR || '/root/Downloads/imap-attachments';
const SHARED_DIR = process.env.UPLOAD_SHARED_DIR || join(ATTACHMENTS_DIR, 'uploads');
const MAX_BYTES = parseInt(process.env.UPLOAD_MAX_BYTES ?? '', 10) || 25 * 1024 * 1024;
const TTL_MS = parseInt(process.env.UPLOAD_TTL_MS ?? '', 10) || 24 * 60 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = parseInt(process.env.UPLOAD_DOWNLOAD_TIMEOUT_MS ?? '', 10) || 60_000;

export interface UploadArgs {
  selector: string;
  filename?: string;
  content_base64?: string;
  url?: string;
  path?: string;
  frame?: string;
}

/** Purge des dépôts périmés (même TTL que l'Imap MCP : 24 h). */
function cleanupStale(): void {
  const now = Date.now();
  let entries: string[];
  try {
    entries = readdirSync(SHARED_DIR);
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(SHARED_DIR, entry);
    try {
      const st = statSync(p);
      if (now - st.mtimeMs > TTL_MS) {
        if (st.isFile()) unlinkSync(p);
        else if (st.isDirectory()) rmSync(p, { recursive: true, force: true });
      }
    } catch {
      /* ignore */
    }
  }
}

function safeName(name: string | undefined, fallback: string): string {
  const n = basename((name ?? '').trim());
  return n && n !== '.' && n !== '..' ? n : fallback;
}

function storeBuffer(buffer: Buffer, filename: string): string {
  if (buffer.length === 0) {
    throw new ActionError('INVALID_INPUT', 'Empty file content');
  }
  if (buffer.length > MAX_BYTES) {
    throw new ActionError('INVALID_INPUT', `File exceeds max upload size of ${MAX_BYTES} bytes (got ${buffer.length})`, {
      max_bytes: MAX_BYTES,
      size: buffer.length,
    });
  }
  mkdirSync(SHARED_DIR, { recursive: true });
  cleanupStale();
  // Un sous-dossier unique par dépôt : le fichier garde son nom exact (c'est ce
  // nom que la page verra dans input.files), sans collision entre dépôts.
  const dir = join(SHARED_DIR, `${Date.now()}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, filename);
  writeFileSync(target, buffer);
  return target;
}

function filenameFromResponse(res: globalThis.Response, url: string): string {
  const cd = res.headers.get('content-disposition') || '';
  const star = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return safeName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')), 'download.bin');
    } catch {
      /* fallthrough */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (plain) return safeName(plain[1], 'download.bin');
  try {
    const last = basename(new URL(url).pathname);
    if (last) return safeName(last, 'download.bin');
  } catch {
    /* ignore */
  }
  return 'download.bin';
}

async function downloadToStore(url: string, filename?: string): Promise<{ path: string; filename: string; size: number }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ActionError('INVALID_INPUT', `Invalid url "${url}"`, { url });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ActionError('INVALID_INPUT', `Unsupported url scheme "${parsed.protocol}" (http/https only)`, { url });
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  let res: globalThis.Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    throw new ActionError('DOWNLOAD_FAILED', `Download failed: ${msg}`, { url });
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw new ActionError('DOWNLOAD_FAILED', `Download failed: HTTP ${res.status}`, { url, status: res.status });
  }
  const declared = parseInt(res.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    clearTimeout(timer);
    throw new ActionError('INVALID_INPUT', `Remote file exceeds max upload size of ${MAX_BYTES} bytes (declared ${declared})`, {
      url,
      max_bytes: MAX_BYTES,
      size: declared,
    });
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ActionError('DOWNLOAD_FAILED', `Download failed while reading body: ${msg}`, { url });
  } finally {
    clearTimeout(timer);
  }
  const name = safeName(filename, filenameFromResponse(res, url));
  const path = storeBuffer(buffer, name);
  return { path, filename: name, size: buffer.length };
}

/** Résout `path` vers un fichier existant du dépôt partagé (anti-traversée). */
function resolveSharedPath(p: string): { path: string; filename: string; size: number } {
  const raw = p.trim();
  if (!raw) throw new ActionError('INVALID_INPUT', 'Empty path');
  const attachmentsRoot = resolve(ATTACHMENTS_DIR);
  const candidates = raw.startsWith('/')
    ? [resolve(raw)]
    : [resolve(SHARED_DIR, raw), resolve(ATTACHMENTS_DIR, raw)];
  for (const c of candidates) {
    if (c !== attachmentsRoot && !c.startsWith(attachmentsRoot + sep)) {
      throw new ActionError('INVALID_INPUT', `path must live under ${ATTACHMENTS_DIR}`, { path: raw });
    }
    if (existsSync(c) && statSync(c).isFile()) {
      const st = statSync(c);
      return { path: c, filename: basename(c), size: st.size };
    }
  }
  throw new ActionError('NOT_FOUND', `No file "${raw}" in ${SHARED_DIR} (nor ${ATTACHMENTS_DIR})`, { path: raw });
}

async function materialize(args: UploadArgs): Promise<{ path: string; filename: string; size: number; source: string }> {
  const sources = [args.content_base64, args.url, args.path].filter((v) => typeof v === 'string' && v.trim() !== '');
  if (sources.length !== 1) {
    throw new ActionError('INVALID_INPUT', 'Provide exactly one of content_base64, url or path');
  }
  if (args.content_base64) {
    const b64 = args.content_base64.replace(/^data:[^;]*;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) {
      throw new ActionError('INVALID_INPUT', 'content_base64 is not valid base64');
    }
    const buffer = Buffer.from(b64, 'base64');
    const filename = safeName(args.filename, 'upload.bin');
    const path = storeBuffer(buffer, filename);
    return { path, filename, size: buffer.length, source: 'content_base64' };
  }
  if (args.url) {
    return { ...(await downloadToStore(args.url, args.filename)), source: 'url' };
  }
  const found = resolveSharedPath(args.path as string);
  const override = args.filename ? safeName(args.filename, found.filename) : found.filename;
  return { ...found, filename: override, source: 'path' };
}

export async function browserUploadFile(args: UploadArgs) {
  try {
    if (!args.selector || !args.selector.trim()) {
      throw new ActionError('INVALID_INPUT', 'selector is required');
    }
    const file = await materialize(args);

    const page = await browserManager.getPage();
    // visible:false : les <input type=file> sont très souvent masqués (display:none)
    // derrière un bouton stylé ; setInputFiles fonctionne quand même.
    const target = await resolveTarget(page, args.selector, {
      frame: args.frame,
      unique: true,
      visible: false,
      timeout: config.defaultTimeout,
    });
    const urlBefore = page.url();

    const kind = await target.locator.evaluate((el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' && (el as HTMLInputElement).type === 'file') return 'file-input';
      if (tag === 'label' && (el as HTMLLabelElement).control) {
        const c = (el as HTMLLabelElement).control as HTMLInputElement;
        if (c.tagName.toLowerCase() === 'input' && c.type === 'file') return 'label';
      }
      return tag;
    });

    // Playwright accepte un chemin (nom = basename) ou un payload nommé ; le
    // payload sert quand le nom demandé diffère du nom sur disque (path + filename).
    const payload: string | { name: string; mimeType: string; buffer: Buffer } =
      basename(file.path) === file.filename
        ? file.path
        : { name: file.filename, mimeType: 'application/octet-stream', buffer: readFileSync(file.path) };

    let via: string;
    if (kind === 'file-input') {
      await target.locator.setInputFiles(payload);
      via = 'setInputFiles';
    } else {
      // Pas un input file : on clique l'élément (bouton, label, zone de drop)
      // et on intercepte le sélecteur de fichier natif qu'il ouvre.
      const chooserP = page.waitForEvent('filechooser', { timeout: 5_000 });
      await target.locator.click({ timeout: config.defaultTimeout });
      let chooser;
      try {
        chooser = await chooserP;
      } catch {
        throw new ActionError(
          'INVALID_TARGET',
          `"${args.selector}" is a <${kind}> that neither is an <input type="file"> nor opens a file chooser when clicked`,
          { selector: args.selector, tag: kind, frame: target.label }
        );
      }
      await chooser.setFiles(payload);
      via = 'filechooser';
    }
    await humanDelay();

    let attached: string[] = [];
    try {
      attached = await target.locator.evaluate((el: Element) => {
        const input =
          el.tagName.toLowerCase() === 'input'
            ? (el as HTMLInputElement)
            : ((el as HTMLLabelElement).control as HTMLInputElement | null);
        return input?.files ? Array.from(input.files).map((f) => f.name) : [];
      });
    } catch {
      /* lecture facultative */
    }

    const url = page.url();
    let title = '';
    try {
      title = await page.title();
    } catch {
      /* ignore */
    }
    const state = {
      ok: true,
      url,
      title,
      navigated: url !== urlBefore,
      uploaded: { filename: file.filename, size: file.size, source: file.source, stored_path: file.path, via },
      input_files: attached,
      frame: target.label,
      note: `Uploaded "${file.filename}" (${file.size} bytes) via ${via}`,
    };
    return { content: [{ type: 'text', text: JSON.stringify(state) }] };
  } catch (err) {
    const info = classifyError(err);
    const body = { ok: false, error: { code: info.code, message: info.message, ...info.details } };
    return { content: [{ type: 'text', text: JSON.stringify(body) }] };
  }
}
