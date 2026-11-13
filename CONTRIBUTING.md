# Contributing to getkestrel.dev

This repo is the website for [Kestrel](https://github.com/kurtbruns/kestrel): the landing page, the `/docs/` guides as rendered on the site, and a contact form. The app itself, its issues, and the text of its guides live in the [kestrel repo](https://github.com/kurtbruns/kestrel), so **a fix to a guide belongs in kestrel's `docs/`**, not here.

## How it's built

A static [Hugo](https://gohugo.io) site deployed to Cloudflare Workers Static Assets. The landing pitch lives in `layouts/index.html` (not `content/_index.md`, which is only a build-time placeholder). The `/docs/` section is kestrel's two doc sets, synced at build time: the developer's Self-hosting guide at `/docs/`, and the publisher's Publishing docs at `/docs/publishing/`. The only dynamic piece is the contact form, which posts to a small Worker (`worker/index.js`).

## Develop

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

The `/docs/` guides are not committed here. `scripts/sync-docs.mjs` builds them from kestrel into the gitignored `content/docs/`: each set's README (`docs/README.md`, `docs/publishing/README.md`) is its landing page and table of contents, and a file no README lists is never a page. The same sync writes a Markdown copy of each page for agents (`/docs/deploy/` → `/docs/deploy.md`), `/llms.txt`, and `/llms-full.txt`, into gitignored paths under `static/`. `/llms.txt` opens with the pitch in `assets/llms-intro.md`, which is written from the landing copy, so edit the two together. If a README lists a page the sync can't read, it exits non-zero, so CI and deploy fail instead of shipping a `/docs/` short of pages. The script's header comment has the README format, the slug rules, and the older layouts it still reads.

Which kestrel to sync from differs by environment, on purpose:

- **Local dev** reads a local checkout, `$KESTREL_DOCS_SRC` or else `~/Git/kestrel`, so you can preview against uncommitted doc changes. With no checkout the site still builds, without `/docs/`.
- **CI and prod** (`.github/workflows/ci.yml`, `deploy.yml`) clone the kestrel **release tag** pinned in `.kestrel-version`, so the live docs only move when that file is bumped, not on every merge into kestrel.

The landing screenshots (`assets/img/*.png`) are captured from a running, seeded kestrel dev server by `scripts/shots.mjs` (`npm run shots`); regenerate them when the app's editor or dashboard UI changes.

### Bumping the pinned kestrel version

Bump `.kestrel-version` with the [`refresh-from-kestrel`](.claude/skills/refresh-from-kestrel/SKILL.md) Claude Code skill rather than by hand. A plain re-sync updates `/docs/`, but it misses landing copy and screenshots that a release made stale; the skill checks those against the changelog and opens a PR.

## The contact form

`/contact/` (Hugo pages `content/contact.md` and `content/contact-sent.md`) posts to `/api/contact`, which `worker/index.js` handles: it checks Turnstile, then emails the message to the owner through the `send_email` binding. The Worker also answers `/docs` requests, so one that prefers `text/markdown` gets the page's Markdown copy; every other page comes straight from the static assets. The Worker's header comment has the routing and the no-JavaScript flow.

- **Secrets:** `TURNSTILE_SECRET` and `CONTACT_TO` (the destination address, kept out of this public repo), set with `npx wrangler secret put` from this repo. Locally they come from `.dev.vars` (copy `.dev.vars.example`, which carries Cloudflare's always-pass Turnstile test secret).
- **The Turnstile site key** is public: `params.turnstileSiteKey` in `hugo.toml`, with the always-pass test key in `config/development/hugo.toml`.
- **To try it locally,** build with `hugo -e development` and run `npx wrangler dev`; the send is simulated and printed. `wrangler dev` serves only the files it saw at startup, so restart it after a rebuild that adds pages.

## Deploy

Config is in `wrangler.jsonc`. A push to `main` deploys via `.github/workflows/deploy.yml`; pull requests run a build-only check (`.github/workflows/ci.yml`).

## Conventions

- **Markdown prose is unwrapped:** one physical line per paragraph, with no hard wrapping. Tables, code fences, and list items keep their own line breaks.
- **Landing a pull request: squash by default**, with the PR's title and description as the commit message.
- **`content/docs/`, the Markdown copies and `llms*.txt` under `static/`, and `public/` are generated** and gitignored — never commit them.
- **Get the roles right in copy.** Kestrel has three roles: a **publisher** writes and sends the newsletter, a **developer** deploys and operates the app, and a **reader** subscribes. `/docs/` is the developer's Self-hosting guide, `/docs/publishing/` the publisher's Publishing docs, and the landing's "self-host" framing addresses the developer. Kestrel retired the old word "operator" into publisher + developer, so don't find-and-replace it mechanically: decide which role each use means.
