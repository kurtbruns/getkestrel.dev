# getkestrel.dev

The front door and operator guides for [Kestrel](https://github.com/kurtbruns/kestrel) — a small, open-source, self-hosted newsletter app. Live at **[getkestrel.dev](https://getkestrel.dev)**.

A static [Hugo](https://gohugo.io) site on Cloudflare Workers. It owns none of your data; the app is the thing you self-host.

## Develop

```bash
npm install
npm run serve   # hugo server at http://localhost:1313
```

The `/docs/` guides are synced at build time from the app repo's `docs/setup/` — a single source of truth, so no copy is committed here. The build clones the public kestrel repo; point `KESTREL_DOCS_SRC` at a local checkout to preview against uncommitted changes.

Regenerate the landing screenshots from a running kestrel dev server with `npm run shots` (see [`scripts/shots.mjs`](scripts/shots.mjs)).

## Deploy

Cloudflare Workers Static Assets. A push to `main` deploys via [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); pull requests run a build check ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). Hosting config is in [`wrangler.jsonc`](wrangler.jsonc).

## License

MIT © Kurt Bruns — see [LICENSE](LICENSE).
