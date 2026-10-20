// da-client.mjs — shared DA/AEM admin client: token resolution, multipart
// upload to admin.da.live, preview/live triggers on admin.hlx.page.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const TOKEN_HINT = 'DA token expired or invalid (IMS tokens last ~3h) — refresh ADOBE_IMS_TOKEN / OF1_TOKEN_FILE';

function readTokenFile(p) {
  const raw = fs.readFileSync(p, 'utf8').trim();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (parsed && typeof parsed === 'object') {
    const t = parsed.access_token || parsed.token;
    if (t) return t;
    throw new Error(`Token file ${p} is JSON but has no access_token`);
  }
  return raw;
}

// Order: opts.tokenFile, $DA_TOKEN, $ADOBE_IMS_TOKEN, $OF1_TOKEN_FILE,
// ./.hlx/.da-token.json, $OF1_DEMO_REPO/.hlx/.da-token.json.
export async function resolveToken({ tokenFile } = {}) {
  if (tokenFile) return readTokenFile(tokenFile);
  if (process.env.DA_TOKEN) return process.env.DA_TOKEN;
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  if (process.env.OF1_TOKEN_FILE) return readTokenFile(process.env.OF1_TOKEN_FILE);
  if (fs.existsSync('.hlx/.da-token.json')) return readTokenFile('.hlx/.da-token.json');
  if (process.env.OF1_DEMO_REPO) {
    const p = path.join(process.env.OF1_DEMO_REPO, '.hlx', '.da-token.json');
    if (fs.existsSync(p)) return readTokenFile(p);
  }
  throw new Error('Could not resolve DA token. Pass --token-file, set $DA_TOKEN/$ADOBE_IMS_TOKEN/$OF1_TOKEN_FILE, or place .hlx/.da-token.json.');
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
export async function daUpload({ owner, repo, path: p, content, contentType, token, fetchImpl = globalThis.fetch }) {
  const { body, contentType: ct } = buildMultipart(content, path.posix.basename(p), contentType);
  return step('upload', p, fetchImpl, `https://admin.da.live/source/${owner}/${repo}/${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': ct },
    body,
  });
}

export async function aemAction({ action, owner, repo, path: p, token, fetchImpl = globalThis.fetch }) {
  return step(action, p, fetchImpl, `https://admin.hlx.page/${action}/${owner}/${repo}/main/${p}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-content-source-authorization': `Bearer ${token}` },
  });
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
