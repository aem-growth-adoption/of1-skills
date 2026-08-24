#!/usr/bin/env node
// Assemble templates/templates-catalog.json + of1/config/templates.json.
//
// Reads every templates/of1-*.metadata.json + corresponding .html and produces
// a fully-inlined catalog (slots, htmlContent, stylesheet) so the OF1 worker
// can route to templates without exceeding the 50-subrequest limit.
//
// Idempotent — safe to re-run after fixing any single template.
//
// Usage:
//     node assemble-catalog.mjs <repo-dir> <owner> <repo> <branch>

import fs from 'node:fs';
import path from 'node:path';

function main(argv) {
  if (argv.length < 6) {
    console.error('usage: assemble-catalog.mjs <repo-dir> <owner> <repo> <branch>');
    return 2;
  }

  const repoDir = path.resolve(argv[2]);
  const owner = argv[3];
  const repo = argv[4];
  const branch = argv[5];
  const templateDir = path.join(repoDir, 'templates');
  const baseUrl = `https://${branch}--${repo}--${owner}.aem.page`;

  if (!fs.existsSync(templateDir)) {
    console.error(`templates/ not found at ${templateDir}`);
    return 1;
  }

  const templates = [];
  const byIntent = {};

  const metaFiles = fs
    .readdirSync(templateDir)
    .filter((f) => /^of1-.*\.metadata\.json$/.test(f))
    .sort();
  if (metaFiles.length === 0) {
    console.error(`No of1-*.metadata.json files found in ${templateDir}`);
    return 1;
  }

  const missingHtml = [];
  for (const metaFile of metaFiles) {
    const metaPath = path.join(templateDir, metaFile);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const name = meta.name;
    const intent = meta.intent;

    if (!name) {
      console.error(`ERROR: ${metaFile} missing required field 'name'`);
      return 1;
    }
    if (!intent) {
      console.error(`ERROR: ${metaFile} missing required field 'intent'`);
      return 1;
    }

    const htmlPath = path.join(templateDir, `${name}.html`);
    if (!fs.existsSync(htmlPath)) {
      missingHtml.push(name);
      continue;
    }
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    const entry = {
      name,
      intent,
      description: meta.description || '',
      minItems: meta.minItems || 1,
      maxItems: meta.maxItems || 4,
      stylesheet: meta.stylesheet || `/styles/${name}.css`,
      slots: meta.slots || [],
      htmlContent,
    };
    templates.push(entry);
    if (!byIntent[intent]) byIntent[intent] = [];
    byIntent[intent].push(name);
  }

  if (missingHtml.length > 0) {
    console.error(`ERROR: missing HTML for: ${missingHtml.join(', ')}`);
    return 1;
  }

  for (const intent of Object.keys(byIntent)) {
    byIntent[intent].sort();
  }

  const byIntentSorted = Object.fromEntries(
    Object.entries(byIntent).sort((a, b) => (a[0] < b[0] ? -1 : 1)),
  );

  const catalog = {
    useRouting: true,
    baseUrl,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    count: templates.length,
    byIntent: byIntentSorted,
    templates,
  };

  const catalogPath = path.join(templateDir, 'templates-catalog.json');
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  console.log(`Wrote ${catalogPath} with ${templates.length} fully-inlined templates`);

  const configDir = path.join(repoDir, 'of1', 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const routing = {
    useRouting: true,
    baseUrl,
    catalogPath: '/templates/templates-catalog.json',
  };
  const routingPath = path.join(configDir, 'templates.json');
  fs.writeFileSync(routingPath, JSON.stringify(routing, null, 2));
  console.log(`Wrote ${routingPath}`);

  const intentsSeen = Object.keys(byIntent).sort();
  const expected = ['comparison', 'recommendation', 'deep-dive', 'budget', 'discovery'];
  const missingIntents = expected.filter((i) => !intentsSeen.includes(i)).sort();
  if (missingIntents.length > 0) {
    console.error(`WARNING: catalog is missing intents: [${missingIntents.map((i) => `'${i}'`).join(', ')}]`);
  }

  console.log(`By intent: ${JSON.stringify(byIntent, null, 2)}`);
  return 0;
}

process.exit(main(process.argv));
