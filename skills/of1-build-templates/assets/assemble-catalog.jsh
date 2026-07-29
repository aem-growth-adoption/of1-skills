// assemble-catalog.jsh — Assemble templates/templates-catalog.json + of1/config/templates.json.
//
// Reads every templates/of1-*.metadata.json + corresponding .html and produces
// a fully-inlined catalog so the OF1 worker can route to templates without
// exceeding the 50-subrequest limit.
//
// Usage:
//   assemble-catalog.jsh <repo-dir> <owner> <repo> <branch>

async function main() {
  if (process.argv.length < 5) {
    console.error('usage: assemble-catalog.jsh <repo-dir> <owner> <repo> <branch>');
    process.exit(2);
  }

  const repoDir = process.argv[1];
  const owner = process.argv[2];
  const repo = process.argv[3];
  const branch = process.argv[4];
  const templateDir = `${repoDir}/templates`;
  const baseUrl = `https://${branch}--${repo}--${owner}.aem.page`;

  // Find metadata files
  let metaFilesRaw;
  try {
    const { stdout } = await exec(`ls ${templateDir}/of1-*.metadata.json 2>/dev/null || true`);
    metaFilesRaw = stdout;
  } catch (e) {
    console.error(`templates/ not found at ${templateDir}`);
    process.exit(1);
  }

  const metaFiles = metaFilesRaw.trim().split('\n').filter(Boolean).sort();
  if (metaFiles.length === 0) {
    console.error(`No of1-*.metadata.json files found in ${templateDir}`);
    process.exit(1);
  }

  const templates = [];
  const byIntent = {};
  const missingHtml = [];

  for (const metaPath of metaFiles) {
    const metaContent = await fs.readFile(metaPath);
    const meta = JSON.parse(metaContent);
    const name = meta.name;
    const intent = meta.intent;

    const htmlPath = `${templateDir}/${name}.html`;
    let htmlContent;
    try {
      htmlContent = await fs.readFile(htmlPath);
    } catch (e) {
      missingHtml.push(name);
      continue;
    }

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
    process.exit(1);
  }

  // Sort intent arrays
  for (const intent of Object.keys(byIntent)) {
    byIntent[intent].sort();
  }

  // Sort byIntent keys
  const sortedByIntent = {};
  for (const key of Object.keys(byIntent).sort()) {
    sortedByIntent[key] = byIntent[key];
  }

  const catalog = {
    useRouting: true,
    baseUrl,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    count: templates.length,
    byIntent: sortedByIntent,
    templates,
  };

  const catalogPath = `${templateDir}/templates-catalog.json`;
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2));
  console.log(`Wrote ${catalogPath} with ${templates.length} fully-inlined templates`);

  // Write routing config
  const configDir = `${repoDir}/of1/config`;
  const routing = {
    useRouting: true,
    baseUrl,
    catalogPath: '/templates/templates-catalog.json',
  };
  const routingPath = `${configDir}/templates.json`;
  await fs.writeFile(routingPath, JSON.stringify(routing, null, 2));
  console.log(`Wrote ${routingPath}`);

  // Check for missing expected intents
  const intentsSeen = Object.keys(sortedByIntent);
  const expected = ['comparison', 'recommendation', 'deep-dive', 'budget', 'discovery'];
  const missingIntents = expected.filter(i => !intentsSeen.includes(i)).sort();
  if (missingIntents.length > 0) {
    console.error(`WARNING: catalog is missing intents: ${JSON.stringify(missingIntents)}`);
  }

  console.log(`By intent: ${JSON.stringify(sortedByIntent, null, 2)}`);
}

await main();
