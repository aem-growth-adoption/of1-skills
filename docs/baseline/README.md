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
node scripts/baseline/baseline.mjs capture --tenant <tenant> --repo-dir <path> --out <file>
node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <file>
```

`--repo-dir` must be a git checkout of the tenant's EDS repo.

Run after every stage; a non-empty diff needs an explanation in the PR.
