#!/usr/bin/env node
// batch.mjs — migrate many repos of one org to the new tenant system.
//   node batch.mjs --org <org> --repos <file|auto> [--dry-run | --no-dry-run]
// --repos <file>: one repo name per line; auto: `gh repo list <org>` (names only).
// Default is --dry-run: each repo is cloned (shallow) into a temp dir, detect only, no writes anywhere.
// --no-dry-run additionally runs the of1-migrate steps in each clone (needs ADOBE_IMS_TOKEN / OF1_TOKEN_FILE).
// Clones use git's own credentials; no token is ever put in a URL or printed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const a = { dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--org') a.org = argv[++i];
    else if (argv[i] === '--repos') a.repos = argv[++i];
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--no-dry-run') a.dryRun = false;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!a.org || !a.repos) throw new Error('usage: batch.mjs --org <org> --repos <file|auto> [--dry-run|--no-dry-run]');
  return a;
}

export function listRepos(spec, org) {
  if (spec === 'auto') {
    const r = spawnSync('gh', ['repo', 'list', org, '--limit', '500', '--json', 'name', '-q', '.[].name'], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('gh repo list failed (is gh installed and logged in?)');
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return readFileSync(spec, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
}

export function detect(dir) {
  const r = spawnSync('git', ['ls-files', 'of1/config'], { cwd: dir, encoding: 'utf8' });
  const tracked = r.stdout.split('\n').filter(Boolean);
  return { legacy: tracked.length > 0, tracked };
}

const STEPS = ['01-detect.sh', '02-config-to-da.sh', '04-sync.sh', '05-verify.sh', '03-remove-git-config.sh', '06-report.sh'];

export function migrateClone(dir, env) {
  for (const s of STEPS) {
    const r = spawnSync('bash', [join(skillDir, 'scripts', s)], { cwd: dir, encoding: 'utf8', env });
    if (s === '01-detect.sh' && r.status === 0 && existsSync(join(env.OF1_STATE_DIR, 'of1-migrate-result.json'))) {
      if (JSON.parse(readFileSync(join(env.OF1_STATE_DIR, 'of1-migrate-result.json'), 'utf8')).status === 'already-new') return 'already-new';
    }
    if (r.status !== 0 && s !== '06-report.sh') { spawnSync('bash', [join(skillDir, 'scripts/06-report.sh')], { cwd: dir, env }); return 'failed'; }
  }
  return 'migrated';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = process.env.OF1_BATCH_CLONE_BASE || `https://github.com/${args.org}`;
  const counts = {};
  for (const repo of listRepos(args.repos, args.org)) {
    const tmp = mkdtempSync(join(tmpdir(), 'of1-migrate-'));
    let status;
    try {
      const c = spawnSync('git', ['clone', '-q', '--depth', '1', `${base}/${repo}.git`, join(tmp, repo)], { encoding: 'utf8' });
      if (c.status !== 0) status = 'clone-failed';
      else if (args.dryRun) status = detect(join(tmp, repo)).legacy ? 'would-migrate' : 'already-new';
      else status = migrateClone(join(tmp, repo), { ...process.env, OF1_DEMO_REPO: join(tmp, repo), OF1_STATE_DIR: join(tmp, 'state') });
    } catch (e) { status = `error: ${e.message}`; }
    finally { rmSync(tmp, { recursive: true, force: true }); }
    counts[status] = (counts[status] || 0) + 1;
    console.log(`${args.org}/${repo}\t${status}`);
  }
  console.log(`summary (${args.dryRun ? 'dry-run' : 'run'}): ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'no repos'}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); } catch (e) { console.error(e.message); process.exit(2); }
}
