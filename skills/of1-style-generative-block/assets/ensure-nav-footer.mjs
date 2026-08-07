#!/usr/bin/env node
// Guarantee the site's /nav and /footer chrome documents exist in DA.
//
// Why: EDS header/footer blocks fetch `/nav` and `/footer` fragments on every
// page. If those documents don't exist, every page — /of1 included — renders
// chromeless (no nav, no footer). stardust:replica is supposed to author them
// but does NOT when the source was bot-blocked (it emits empty <header></header>
// pages and never creates the fragments); the of1-adopt-existing-site flow runs
// against a site that already has them. This guard makes the of1 side own the
// invariant either way: if /nav or /footer is missing, author a minimal branded
// one from the pages actually deployed on this branch.
//
// Idempotent: if both already return 200 (existing EDS site, or replica did its
// job), it changes nothing. It NEVER overwrites an existing chrome document.
//
// Usage:
//   node ensure-nav-footer.mjs
// Env (same as the rest of the pipeline):
//   OF1_STATE_DIR, ADOBE_IMS_TOKEN | OF1_TOKEN_FILE
// Exit codes: 0 ok (present or created) · 1 hard failure (auth / write / verify).

import fs from 'node:fs';
import path from 'node:path';

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function resolveToken() {
  if (process.env.ADOBE_IMS_TOKEN) return process.env.ADOBE_IMS_TOKEN;
  const tokenFile = process.env.OF1_TOKEN_FILE;
  if (tokenFile && fs.existsSync(tokenFile)) {
    try {
      return JSON.parse(fs.readFileSync(tokenFile, 'utf8')).access_token;
    } catch {
      return null;
    }
  }
  return null;
}

async function head200(url) {
  try {
    const r = await fetch(url, { method: 'GET' });
    return r.status === 200;
  } catch {
    return false;
  }
}

// Raw PUT of an HTML document to DA source (same mechanism as the /of1 doc in
// of1-style-generative-block — text/html docs use raw PUT, not multipart).
async function putDoc(token, owner, repo, name, html) {
  const url = `https://admin.da.live/source/${owner}/${repo}/${name}.html`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/html' },
    body: html,
  });
  if (!r.ok) fail(`PUT ${name}.html → HTTP ${r.status}`);
}

async function triggerPreview(token, owner, repo, branch, name) {
  const url = `https://admin.hlx.page/preview/${owner}/${repo}/${branch}/${name}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-content-source-authorization': `Bearer ${token}`,
    },
  });
  if (!r.ok) fail(`preview ${name} → HTTP ${r.status} (missing x-content-source-authorization or expired token?)`);
}

function titleCase(s) {
  return String(s ?? '').replace(/[A-Za-z]+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

// Discover the pages deployed on this branch to build a functional demo nav.
// Prefer /tmp/da-pages.txt (written by of1-publish), fall back to the repo's
// migrated/content slugs. Excludes chrome and utility docs.
function discoverPages(repoDir) {
  const skip = new Set(['nav', 'footer', 'of1', '404', 'index']);
  const slugs = [];
  const pagesFile = '/tmp/da-pages.txt';
  if (fs.existsSync(pagesFile)) {
    for (const line of fs.readFileSync(pagesFile, 'utf8').split('\n')) {
      const name = path.basename(line.trim(), path.extname(line.trim()));
      if (name && !skip.has(name) && !slugs.includes(name)) slugs.push(name);
    }
  }
  if (!slugs.length) {
    const migratedDir = path.join(repoDir, 'stardust', 'migrated');
    if (fs.existsSync(migratedDir)) {
      for (const f of fs.readdirSync(migratedDir).filter((x) => x.endsWith('.html')).sort()) {
        const name = path.basename(f, '.html');
        if (name && !skip.has(name) && !slugs.includes(name)) slugs.push(name);
      }
    }
  }
  return slugs;
}

// Minimal vanilla-aem-boilerplate nav fragment: brand + a sections list. The
// header block decorates the first section as brand, the rest as nav sections.
function buildNav(domain, slugs) {
  const brand = titleCase(String(domain).replace(/^www\./, '').split('.')[0]);
  const links = ['<li><a href="/">Home</a></li>'];
  for (const s of slugs) {
    links.push(`<li><a href="/${s}">${titleCase(s.replace(/-/g, ' '))}</a></li>`);
  }
  links.push('<li><a href="/of1">Ask Anything</a></li>');
  return `<body><header></header><main><div>
<p><a href="/">${brand}</a></p>
<ul>
${links.join('\n')}
</ul>
</div></main><footer></footer></body>`;
}

function buildFooter(domain) {
  const brand = titleCase(String(domain).replace(/^www\./, '').split('.')[0]);
  const year = process.env.OF1_YEAR || ''; // year passed in to avoid Date nondeterminism; optional
  const copy = year ? `© ${year} ${brand}` : `© ${brand}`;
  return `<body><header></header><main><div>
<p>${copy}. Demo experience powered by OF1.</p>
<p><a href="/">Home</a> · <a href="/of1">Ask Anything</a></p>
</div></main><footer></footer></body>`;
}

async function ensure(token, owner, repo, branch, name, previewBase, buildFn) {
  // The header/footer blocks fetch the fragment via loadFragment(path) →
  // `${path}.plain.html`, so `.plain.html` is the URL that actually has to
  // resolve — check exactly that, not the bare doc.
  const fragUrl = `${previewBase}/${name}.plain.html`;
  if (await head200(fragUrl)) {
    console.log(`  ✓ /${name} already exists — leaving it untouched`);
    return;
  }
  console.log(`  … /${name} missing — authoring a minimal branded ${name}`);
  await putDoc(token, owner, repo, name, buildFn());
  await triggerPreview(token, owner, repo, branch, name);
  if (!(await head200(fragUrl))) fail(`/${name}.plain.html still not 200 after PUT+preview — chrome will not render`);
  console.log(`  ✓ /${name} created and live`);
}

async function main() {
  const stateDir = process.env.OF1_STATE_DIR;
  if (!stateDir) fail('OF1_STATE_DIR not set');
  const repoConfig = JSON.parse(fs.readFileSync(path.join(stateDir, 'repo-config.json'), 'utf8'));
  const { owner, repo, branch, domain, repoDir } = repoConfig;
  if (!owner || !repo || !branch) fail('repo-config.json missing owner/repo/branch');

  const token = resolveToken();
  if (!token) fail('no DA token (set ADOBE_IMS_TOKEN or OF1_TOKEN_FILE)');

  const previewBase = `https://${branch}--${repo}--${owner}.aem.page`;
  const rootDir = repoDir || '.';
  const slugs = discoverPages(rootDir);

  console.log(`Ensuring /nav and /footer for ${previewBase} (${slugs.length} content page(s) for nav)`);
  await ensure(token, owner, repo, branch, 'nav', previewBase, () => buildNav(domain, slugs));
  await ensure(token, owner, repo, branch, 'footer', previewBase, () => buildFooter(domain));
  console.log('✓ Chrome fragments guaranteed.');
}

main().catch((e) => fail(e.message));
