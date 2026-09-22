# getkestrel.dev

The front door and developer guides for [Kestrel](https://github.com/kurtbruns/kestrel) — a small, open-source, self-hosted newsletter app. Live at **[getkestrel.dev](https://getkestrel.dev)**.

A static [Hugo](https://gohugo.io) site on Cloudflare Workers. It owns none of your data; the app is the thing you self-host.

## Develop

```bash
npm install
npm run serve   # hugo server at http://localhost:1313
```

The `/docs/` guides are synced at build time from the app repo's `docs/setup/` — a single source of truth, so no copy is committed here. Locally, the build reads a kestrel checkout (default `~/Git/kestrel`); point `KESTREL_DOCS_SRC` at another checkout to preview against uncommitted changes.

CI and prod builds instead pin a kestrel **release tag** — the ref in [`.kestrel-docs-version`](.kestrel-docs-version) — so the live docs only move when we say so, not on every merge into kestrel.

**To pick up a newer kestrel release,** use the `refresh-from-kestrel` Claude Code skill (in [`.claude/skills/refresh-from-kestrel/`](.claude/skills/refresh-from-kestrel/)): tell Claude to bump to the new tag and it reads the old→new changelog delta, re-syncs the docs, proves whether the rendered `/docs/` actually changed, flags stale landing copy and a stale hero screenshot, and opens a **draft** PR for review. Merging that PR is the same `edit .kestrel-docs-version → PR → merge` flow — the deploy on `main` then rebuilds `/docs/` from the new tag. The skill exists because the pin bump is the easy part; the point is catching the copy and screenshots a plain re-sync would leave silently stale. You can still edit `.kestrel-docs-version` by hand, but the skill is the maintained procedure.

Regenerate the landing screenshots from a running kestrel dev server with `npm run shots` (see [`scripts/shots.mjs`](scripts/shots.mjs)). The skill flags when a bump makes them stale.

## Deploy

Cloudflare Workers Static Assets. A push to `main` deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); pull requests run a build check ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Hosting config is in [`wrangler.jsonc`](wrangler.jsonc).

## License

MIT © Kurt Bruns — see [LICENSE](LICENSE).
