# getkestrel.dev

The front door and developer guides for [Kestrel](https://github.com/kurtbruns/kestrel) — a small, open-source, self-hosted newsletter app. Live at **[getkestrel.dev](https://getkestrel.dev)**.

A static [Hugo](https://gohugo.io) site on Cloudflare Workers. It owns none of your data; the app is the thing you self-host.

## Develop

```bash
npm install
npm run serve   # hugo server at http://localhost:1313
```

That serves the landing page right away. The `/docs/` guides are synced at build time from a Kestrel checkout — point `KESTREL_DOCS_SRC` at one (default `~/Git/kestrel`) to preview them locally; without one, the site still builds, just without `/docs/`.

## More

How the docs sync and version pin work, how to bump to a new Kestrel release (the `refresh-from-kestrel` skill), how deploys run, and the repo conventions all live in [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

## License

MIT © Kurt Bruns — see [LICENSE](LICENSE).
