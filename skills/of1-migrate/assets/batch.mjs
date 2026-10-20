#!/usr/bin/env node
// batch.mjs — migrate many repos of one org to the new tenant system.
//   node batch.mjs --org <org> --repos <file|auto> [--dry-run | --no-dry-run] [--yes] [--out <dir>]
// --repos <file>: one `repo` per line (always the default branch; repos are expected to have OF1 on `main`, others stop with "OF1 setup runs from the main branch"); auto: `gh repo list <org>` (names only).
// Default is --dry-run: each repo is cloned (shallow) into a temp dir, detect only, no writes anywhere.
// --no-dry-run additionally runs the of1-migrate steps in each clone (needs ADOBE_IMS_TOKEN / OF1_TOKEN_FILE) and
// requires --repos <file> or --yes (auto lists the org's non-fork, non-archived repos). Per-repo result JSON goes to --out (default ./of1-migrate-results).
// Clones use git's own credentials; no token is ever put in a URL or printed.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const a = { dryRun: true, yes: false, out: './of1-migrate-results' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--org') a.org = argv[++i];
    else if (argv[i] === '--repos') a.repos = argv[++i];
    else if (argv[i] === '--dry-run') a.dryRun = true;
    else if (argv[i] === '--no-dry-run') a.dryRun = false;
    else if (argv[i] === '--yes') a.yes = true;
    else if (argv[i] === '--out') a.out = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!a.org || !a.repos) throw new Error('usage: batch.mjs --org <org> --repos <file|auto> [--dry-run|--no-dry-run]');
  if (!a.dryRun && a.repos === 'auto' && !a.yes) throw new Error('--no-dry-run with --repos auto needs --yes (or pass --repos <file>)');
  return a;
}

export function listRepos(spec, org) {
  if (spec === 'auto') {
    const r = spawnSync('gh', ['repo', 'list', org, '--limit', '500', '--no-archived', '--source', '--json', 'name,isFork,isArchived', '-q', '.[] | select((.isFork | not) and (.isArchived | not)) | .name'], { encoding: 'utf8' });
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
  const resFile = join(env.OF1_STATE_DIR, 'of1-migrate-result.json');
  const result = () => (existsSync(resFile) ? JSON.parse(readFileSync(resFile, 'utf8')) : null);
  const mk = (status) => ({ status, result: result() });
  for (const s of STEPS) {
    const r = spawnSync('bash', [join(skillDir, 'scripts', s)], { cwd: dir, encoding: 'utf8', env });
    if (s === '01-detect.sh' && r.status === 0 && result()?.status === 'already-new') return mk('already-new');
    if (r.status !== 0 && s !== '06-report.sh') {
      spawnSync('bash', [join(skillDir, 'scripts/06-report.sh')], { cwd: dir, env });
      const res = mk('failed');
      if (!res.result) res.result = { status: 'failed', errors: [{ step: s, error: (r.stderr || '').trim().slice(-400) }] };
      return res;
    }
  }
  return mk('migrated');
}

export function runBatch(args, env = process.env, log = console.log) {
  const base = env.OF1_BATCH_CLONE_BASE || `https://github.com/${args.org}`;
  const repos = listRepos(args.repos, args.org);
  if (args.repos === 'auto') {
    log(`resolved repos (${repos.length}, forks and archived excluded): ${repos.join(', ')}`);
    log('note: only each default branch is examined; repos are expected to have OF1 on main');
  }
  if (!args.dryRun) mkdirSync(args.out, { recursive: true });
  const counts = {};
  for (const entry of repos) {
    const tmp = mkdtempSync(join(tmpdir(), 'of1-migrate-'));
    const repo = entry;
    let status, detail = null;
    try {
      const c = spawnSync('git', ['clone', '-q', '--depth', '1', `${base}/${repo}.git`, join(tmp, repo)], { encoding: 'utf8' });
      if (c.status !== 0) status = 'clone-failed';
      else if (args.dryRun) status = detect(join(tmp, repo)).legacy ? 'would-migrate' : 'already-new';
      else {
        const m = migrateClone(join(tmp, repo), { ...env, OF1_DEMO_REPO: join(tmp, repo), OF1_STATE_DIR: join(tmp, 'state') });
        status = m.status; detail = m.result;
        writeFileSync(join(args.out, `${entry}.json`), JSON.stringify({ repo: `${args.org}/${repo}`, ...detail, status }, null, 2));
      }
    } catch (e) { status = `error: ${e.message}`; }
    finally { rmSync(tmp, { recursive: true, force: true }); }
    counts[status] = (counts[status] || 0) + 1;
    log(`${args.org}/${entry}\t${status}`);
    for (const e of detail?.errors ?? []) log(`    ${e.step}: ${String(e.error).split('\n')[0]}`);
  }
  log(`summary (${args.dryRun ? 'dry-run' : 'run'}): ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ') || 'no repos'}`);
  return counts;
}

function main() { runBatch(parseArgs(process.argv.slice(2))); }

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try { main(); } catch (e) { console.error(e.message); process.exit(2); }
}
