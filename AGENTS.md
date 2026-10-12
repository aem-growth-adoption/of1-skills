# of1-skills

Claude Code plugin that integrates OF1 (branded generative search) into an
**existing** Adobe EDS site. Entry skill: `of1-integration`, which runs its own
step graph (see `skills/of1-integration/SKILL.md`). No crawling or site building.

`of1-demo-skills` (sibling repo) builds full demos and is a *caller* of this
plugin. It currently still dispatches individual skills with
`OF1_PIPELINE_MODE=1`. Pipeline mode and the SLICC runtime still exist here;
both are slated for removal per
`docs/superpowers/specs/2026-10-09-of1-skills-cleanup-design.md`.

## Layout

- `skills/<name>/SKILL.md`: one skill each; `skills/*/assets/*.mjs`: Node helpers + tests
- `skills/of1-integration/knowledge/`: shared references (config schemas, DA sync)
- `scripts/baseline/`: structural regression baseline tooling
- `docs/baseline/`: golden shape of a known-good integration
- `docs/superpowers/{specs,plans}/`: design docs (index: `docs/README.md`)

## Skills

`of1-integration` (entry), `of1-check-dependencies`, `of1-extract-design`,
`of1-build-templates`, `of1-style-generative-block`, `of1-extract-brand-voice`,
`of1-extract-content`, `of1-build-quick-suggestions`, `of1-build-cta-template`
(pipeline mode only), `of1-publish`.

## Commands

```
node --test skills/*/assets/*.test.mjs scripts/baseline/*.test.mjs
bash -n <script>.sh        # syntax-check every shell script you touch
```

`node --test <dir>` does not work on Node 23; pass file globs.

## Baseline workflow

Run after every stage of the cleanup; a non-empty diff needs an explanation in the PR.

```
node scripts/baseline/baseline.mjs capture --tenant <tenant> --repo-dir <path> --out <file>
node scripts/baseline/baseline.mjs diff docs/baseline/of1-site-da-first.shape.json <file>
```

See `docs/baseline/README.md`.

## Conventions

- Config is authored in DA; git only gets `of1/config/config.json`. Never
  commit any other `of1/config/*.json`.
- Commit with a scoped pathspec: `git commit -m ... -- <paths>`; never `git add -A`.
- Before every push: `git pull --rebase --autostash`; on conflict abort and
  stop. Never force-push.
- Never delete non-OF1 content from the customer repo.
- Skills are prose + bash: keep steps idempotent (re-runs must be safe).
- Update `CHANGELOG.md` and the status in `docs/README.md` with each change.
