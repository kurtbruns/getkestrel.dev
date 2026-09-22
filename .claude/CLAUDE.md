# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

getkestrel.dev is the front door and developer guides for [Kestrel](https://github.com/kurtbruns/kestrel) — a small, open-source, self-hosted newsletter app. It's a static [Hugo](https://gohugo.io) site deployed to Cloudflare Workers Static Assets; it owns none of a publisher's data, since the app is the thing you self-host. The landing pitch lives in `layouts/index.html` (not `content/_index.md`, which is only a build-time placeholder), and the `/docs/` section is the developer/setup guides, synced from the app repo at build time.

## Commands

```bash
npm install
npm run serve        # hugo server at http://localhost:1313 (scripts/dev-hugo.sh)
npm run docs:sync    # sync /docs/ from a kestrel checkout into the gitignored content/docs/
npm run shots        # regenerate the landing screenshots from a running, seeded kestrel dev server
npm run hugo:check   # verify the Hugo version in .tool-versions matches hugo.toml's `min`
hugo --minify        # the production build that CI and deploy run
```

## How the docs pin works

The `/docs/` guides are not committed here. `scripts/sync-docs.mjs` syncs them at build time from kestrel's `docs/setup/*.md` into a gitignored `content/docs/` tree, adding a small front-matter shim (title from the first `# H1`, menu weight from the `NN-` filename prefix, and an index page). That shim is why the ingest is a script and not a Hugo Modules mount — a mount would carry the raw Markdown, not the transform.

Which kestrel to sync from differs by environment, on purpose:

- **Local dev** reads a local checkout — `$KESTREL_DOCS_SRC`, else `~/Git/kestrel` — so you can preview against uncommitted doc changes. If no checkout is present the site still builds, just without `/docs/`.
- **CI and prod** (`.github/workflows/ci.yml`, `deploy.yml`) clone the kestrel **release tag** pinned in `.kestrel-docs-version`, so the live docs only move when that file is bumped, not on every merge into kestrel.

The landing screenshots (`assets/img/*.png`) are captured from a running, seeded kestrel dev server by `scripts/shots.mjs` (`npm run shots`); regenerate them when the app's editor or dashboard UI changes.

## Bumping the pinned kestrel version

When kestrel cuts a new release, use the **`refresh-from-kestrel` skill** (`.claude/skills/refresh-from-kestrel/`) rather than editing the pin by hand. Bumping `.kestrel-docs-version` is a one-line edit; the skill exists to catch what a plain re-sync leaves silently stale — a landing claim that stopped being true, or a hero screenshot of an editor UI that has since changed. It reads the old→new changelog delta, re-syncs the docs, proves whether the rendered `/docs/` actually changed, flags stale landing copy and a stale screenshot by reading the live landing page against the delta, and opens a **draft** PR for review. Merging that PR is the same flow as always — `edit .kestrel-docs-version → PR → merge` — and the deploy on `main` then rebuilds `/docs/` from the new tag.

## The role model (before editing copy)

Kestrel has three roles and the site's copy depends on getting them right: a **publisher** writes and sends the newsletter, a **developer** deploys and operates the app, and a **reader** subscribes. getkestrel.dev's `/docs/` are the developer/setup guides, and the landing's "self-host" framing addresses the developer. Kestrel retired the old word "operator" into publisher + developer; don't mechanically find-replace it (PR #27 had to correct a bad `operator → publisher` edit to `operator → developer`). The skill's `SKILL.md` restates this where copy edits happen.

## Deploy

Cloudflare Workers Static Assets, config in `wrangler.jsonc`. A push to `main` deploys via `.github/workflows/deploy.yml`; pull requests run a build-only check (`.github/workflows/ci.yml`). Both read `.kestrel-docs-version` and clone that kestrel tag before building.

## Conventions

- **Markdown prose is unwrapped** — one physical line per paragraph, no hard wrapping at a fixed column (let the editor soft-wrap). Applies to `README.md`, this file, and content prose. Tables, code fences, and list items keep their own line breaks.
- **Landing a pull request: squash by default**, with the PR's title and description as the commit message.
- **`content/docs/` and `public/` are generated** and gitignored — never commit them.
- **Don't rename `/docs/` → `/guides/`** as a side effect of another change; that's a separate, deliberate move (issue #15).
