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
node scripts/baseline/baseline.mjs capture --tenant <host-label> --repo-dir <path> --out <file>
node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <file>
```

`--repo-dir` must be a git checkout of the tenant's EDS repo.

`--tenant` is the preview host label `main--<repo>--<owner>` (lowercase). `capture` uses it for:

- the preview base `https://<label>.aem.page`;
- the proxied host `https://<label>.of1.live` for `/api/generate` (`OF1_GENERATE_BASE_URL` overrides);
- **and, wrongly, as the worker tenant id**: `GET <worker>/api/tenants/<label>/status` and the
  `/api/generate` body `domain: <label>`. Since 0.4.0 the tenant id is `<org>/<repo>`, so for a
  migrated tenant the captured `status` (and possibly `generate`) shape does not reflect the real
  tenant. Known bug in `scripts/baseline/baseline.mjs`, not fixed yet; compare those two keys with care.

The golden shape predates the `org/repo` tenant system and the main-only host (its label uses the
`of1-da-first` branch).

Run after a change that can alter the integration output; a non-empty diff needs an explanation in the PR.
