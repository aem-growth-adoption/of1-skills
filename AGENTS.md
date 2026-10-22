# of1-skills

Claude Code plugin that integrates OF1 (branded generative search) into an
**existing** Adobe EDS site. Entry skill: `of1-integration`, which runs its own
step graph (see `skills/of1-integration/SKILL.md`). No crawling or site building.

The skills name no specific caller. Callers use the stable interface in
`docs/contract.md` (arguments, status files, `of1-integration-result.json`).
`of1-integration` is a driver and must run from a top-level context.

## Layout

- `skills/<name>/SKILL.md`: one skill each; `skills/*/assets/*.mjs`: Node helpers + tests;
  `skills/*/scripts/`: step bash (SKILL.md <= 200 lines, bash blocks <= 25); `lib/`: shared helpers (`env.sh`, `da-client.mjs`, ...)
- `skills/of1-integration/knowledge/`: shared references (config schemas, DA sync)
- `scripts/baseline/`: structural regression baseline tooling
- `docs/baseline/`: golden shape of a known-good integration
- `docs/superpowers/{specs,plans}/`: design docs (index: `docs/README.md`)

## Skills

`of1-integration` (entry), `of1-check-dependencies`, `of1-extract-design`,
`of1-build-templates`, `of1-style-generative-block`, `of1-extract-brand-voice`,
`of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`
(only with `cta-template`), `of1-publish`.

## Commands

```
node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs lib/*.test.mjs skills/*/scripts/*.test.mjs
bash -n <script>.sh        # syntax-check every shell script you touch
```

`node --test <dir>` does not work on Node 23; pass file globs.

## Baseline workflow

Run after every stage of the cleanup; a non-empty diff needs an explanation in the PR.

```
node scripts/baseline/baseline.mjs capture --tenant <host-label> --repo-dir <path> --out <file>
node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <file>
```

`--tenant` is the preview **host label** `main--<repo>--<owner>` (it builds `https://<label>.aem.page`), not the worker tenant id, which is `<org>/<repo>` (`$TENANT_ID`). See `docs/baseline/README.md`.

## Conventions

- Config is authored in DA; git gets no `of1/config/{config,cta-template,signals,llmquestions,context-endpoints}.json`. Never
  commit any other `of1/config/*.json`; `of1-migrate` removes only the files it converted (`assets/to-sheet.mjs` defines the sheet formats) and leaves the rest.
- OF1 setup runs from `main`: `of1_require_main` (lib/env.sh) guards check-dependencies, migrate, publish.
- Commit with a scoped pathspec: `git commit -m ... -- <paths>`; never `git add -A`.
- Before every push: `git pull --rebase --autostash`; on conflict abort and
  stop. Never force-push.
- Never delete non-OF1 content from the customer repo.
- Skills are prose + bash: keep steps idempotent (re-runs must be safe).
- Update `CHANGELOG.md` and the status in `docs/README.md` with each change.
