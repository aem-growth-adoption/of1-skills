# Baseline

`of1-site-da-first.shape.json` is the golden *shape* of the integrated tenant
`of1-da-first--of1-site--aem-growth-adoption` (repo `of1-site-da-first`), captured 2026-10-09
against the public preview and the prod worker.

It records structure, not content: config keys, template/block names, table columns and row
counts, worker status, generate response shape (event types, `hasSections` = at least 2
section events, exact `errors`), `hasKnowledgePages` (boolean), and the list of git files
the integration owns. Volatile text is deliberately excluded.

## Commands

```
node scripts/baseline/baseline.mjs capture --tenant <host-label> [--tenant-id <org>/<repo>] [--worker <url>] --repo-dir <path> --out <file>
node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <file>
```

`--repo-dir` must be a git checkout of the tenant's EDS repo.

`--tenant` is the preview host label `main--<repo>--<owner>` (lowercase). `capture` uses it for:

- the preview base `https://<label>.aem.page`;
- the proxied host `https://<label>.of1.live` for `/api/generate` (`OF1_GENERATE_BASE_URL` overrides).

Worker calls use the gen-web tenant id `<org>/<repo>` (lowercase, same as `$TENANT_ID` in
`lib/env.sh`): `GET <worker>/api/tenants/<org>/<repo>/status` and the `/api/generate` body
`domain: <org>/<repo>`. It is derived from the label (`<branch>--<repo>--<owner>` → `owner/repo`);
pass `--tenant-id <org>/<repo>` when the label is ambiguous (a repo or owner name containing `--`)
or to override it. `--worker ''` skips both worker calls.

The golden shape predates the `org/repo` tenant system and the main-only host (its label uses the
`of1-da-first` branch), and its `status`/`generate` were captured when the label was still the
gen-web tenant id; re-capture before treating a diff on those two keys as a regression.

Run after a change that can alter the integration output; a non-empty diff needs an explanation in the PR.
