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
npm run og           # re-render the social card (assets/img/og.png) from scripts/og-card.html
npm run hugo:check   # verify the Hugo version in .tool-versions matches hugo.toml's `min`
hugo --minify        # the production build that CI and deploy run
```

## How the docs pin works

The `/docs/` guides are not committed here. `scripts/sync-docs.mjs` syncs them at build time from kestrel into a gitignored `content/docs/` tree. kestrel's `docs/README.md` is the guide's landing page and table of contents: its title and intro, then a `##` per section (blurb, and a numbered or bulleted list of the section's pages, which live in folders such as `docs/get-started/`). The sync turns that into the `/docs/` landing's front matter and adds a small shim to each page (title from the first `# H1`, its weight, section, and step), and points the pages' relative links at the site's URLs. Releases up to v1.2.0 have the older flat `docs/setup/NN-*.md` layout instead, which the sync still reads. That shim is why the ingest is a script and not a Hugo Modules mount — a mount would carry the raw Markdown, not the transform.

Which kestrel to sync from differs by environment, on purpose:

- **Local dev** reads a local checkout — `$KESTREL_DOCS_SRC`, else `~/Git/kestrel` — so you can preview against uncommitted doc changes. If no checkout is present the site still builds, just without `/docs/`.
- **CI and prod** (`.github/workflows/ci.yml`, `deploy.yml`) clone the kestrel **release tag** pinned in `.kestrel-docs-version`, so the live docs only move when that file is bumped, not on every merge into kestrel.

The landing screenshots (`assets/img/*.png`) are captured from a running, seeded kestrel dev server by `scripts/shots.mjs` (`npm run shots`); regenerate them when the app's editor or dashboard UI changes.

## Bumping the pinned kestrel version

Bump `.kestrel-docs-version` only via the **`refresh-from-kestrel` skill**, never by hand — it catches the stale landing copy and screenshots a plain re-sync misses.

## The role model (before editing copy)

Kestrel has three roles and the site's copy depends on getting them right: a **publisher** writes and sends the newsletter, a **developer** deploys and operates the app, and a **reader** subscribes. getkestrel.dev's `/docs/` are the developer/setup guides, and the landing's "self-host" framing addresses the developer. Kestrel retired the old word "operator" into publisher + developer; don't mechanically find-replace it (PR #27 had to correct a bad `operator → publisher` edit to `operator → developer`). The skill's `SKILL.md` restates this where copy edits happen.

## The contact form

The site is static except for one route. `/contact/` (Hugo pages `content/contact.md` and `content/contact-sent.md`) posts to `/api/contact`, which `worker/index.js` handles; `run_worker_first: ["/api/*"]` in `wrangler.jsonc` sends only that path to the script, so every page still comes straight from the static assets. The Worker checks Turnstile, then emails the message through the `send_email` binding to the owner's verified address (free on every plan, through Email Routing on getkestrel.dev), with the visitor in Reply-To. The form works without JavaScript: every outcome is a 303 to `/contact/sent/` or back to `/contact/?error=…`.

- **Secrets:** `TURNSTILE_SECRET` and `CONTACT_TO` (the destination address, kept out of this public repo), set with `npx wrangler secret put` from this repo. Locally they come from `.dev.vars` (copy `.dev.vars.example`, which carries Cloudflare's always-pass Turnstile test secret).
- **The Turnstile site key** is public: `params.turnstileSiteKey` in `hugo.toml`, with the always-pass test key in `config/development/hugo.toml`.
- **To try it locally,** build with `hugo -e development` and run `npx wrangler dev`; the send is simulated and printed. `wrangler dev` serves only the files it saw at startup, so restart it after a rebuild that adds pages.

## Deploy

Cloudflare Workers Static Assets, config in `wrangler.jsonc`. A push to `main` deploys via `.github/workflows/deploy.yml`; pull requests run a build-only check (`.github/workflows/ci.yml`). Both read `.kestrel-docs-version` and clone that kestrel tag before building.

## Conventions

- **Markdown prose is unwrapped** — one physical line per paragraph, no hard wrapping at a fixed column (let the editor soft-wrap). Applies to `README.md`, this file, and content prose. Tables, code fences, and list items keep their own line breaks.
- **Landing a pull request: squash by default**, with the PR's title and description as the commit message.
- **`content/docs/` and `public/` are generated** and gitignored — never commit them.
- **Don't rename `/docs/` → `/guides/`** as a side effect of another change; that's a separate, deliberate move (issue #15).
