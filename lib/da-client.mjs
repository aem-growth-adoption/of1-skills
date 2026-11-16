// da-client.mjs — shared DA/AEM admin client: token resolution, multipart
// upload to admin.da.live, preview/live triggers on admin.hlx.page.

import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const TOKEN_HINT = 'DA token expired or invalid — set DA_TOKEN or run da-auth-helper again';

// $DA_TOKEN, else the da-auth-helper token (stdout).
export async function resolveToken({ exec = execFileSync } = {}) {
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  try {
    const out = exec('npx', ['-y', 'github:adobe-rnd/da-auth-helper', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
    const token = String(out).trim();
    if (token) return token;
  } catch { /* fall through */ }
  throw new Error('No DA token: set DA_TOKEN or sign in with da-auth-helper');
}

export function buildMultipart(content, filename, contentType) {
  const boundary = '----DABoundary' + crypto.randomBytes(8).toString('hex');
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const payload = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
  return { body: Buffer.concat([head, payload, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function step(name, label, fetchImpl, url, opts) {
  try {
    const resp = await fetchImpl(url, opts);
    if (resp.ok) return null;
    // A DA 401/403 means the token itself is bad; a preview 403 is a separate
    // AEM-rights grant, so only the upload step gets the token hint.
    const hint = name === 'upload' && (resp.status === 401 || resp.status === 403) ? ` — ${TOKEN_HINT}` : '';
    return `FAIL ${name} ${label} HTTP ${resp.status}${hint}`;
  } catch (e) {
    return `FAIL ${name} ${label} ERROR ${e.message}`;
  }
}

// `path` includes the extension (e.g. of1/x.html, media/y.png).
export async function daUpload({ org, repo, path: p, content, contentType, token, fetchImpl = globalThis.fetch }) {
  const { body, contentType: ct } = buildMultipart(content, path.posix.basename(p), contentType);
  return step('upload', p, fetchImpl, `https://admin.da.live/source/${org}/${repo}/${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': ct },
    body,
  });
}

export async function aemAction({ action, org, repo, path: p, token, fetchImpl = globalThis.fetch }) {
  return step(action, p, fetchImpl, `https://admin.hlx.page/${action}/${org}/${repo}/main/${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-content-source-authorization': `Bearer ${token}` },
  });
}

export async function daGet({ org, repo, path: p, token, fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`https://admin.da.live/source/${org}/${repo}/${p}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: resp.status, text: resp.status === 404 ? '' : await resp.text() };
}

export async function daList({ org, repo, path: p, token, fetchImpl = globalThis.fetch }) {
  const resp = await fetchImpl(`https://admin.da.live/list/${org}/${repo}/${p}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`daList ${p} HTTP ${resp.status}${resp.status === 401 || resp.status === 403 ? ` — ${TOKEN_HINT}` : ''}`);
  const items = await resp.json();
  return items.map((i) => (i.ext ? { path: i.path, ext: i.ext } : { path: i.path }));
}

// Condense `FAIL <step> <path> HTTP 500` / `... ERROR msg` to the terse
// `<step> HTTP 500` / `<step> error: msg` strings the CLIs print.
export function briefError(msg, stepName) {
  if (!msg) return msg;
  const http = msg.match(/ HTTP (\d+)(.*)$/);
  if (http) return `${stepName} HTTP ${http[1]}${http[2]}`;
  const err = msg.match(/ ERROR (.*)$/);
  return err ? `${stepName} error: ${err[1]}` : msg;
}
