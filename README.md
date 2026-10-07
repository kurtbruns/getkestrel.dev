# getkestrel.dev

The source for **[getkestrel.dev](https://getkestrel.dev)**, the website for [Kestrel](https://github.com/kurtbruns/kestrel), a small, open-source, self-hosted newsletter app.

Looking for Kestrel itself? The app, its issues, and its setup guides live in the [kestrel repo](https://github.com/kurtbruns/kestrel). This repo is only the website: the landing page, the `/docs/` guides as rendered on the site, and a contact form.

## How it's built

A static [Hugo](https://gohugo.io) site served by Cloudflare Workers Static Assets. The only dynamic piece is the contact form, which posts to a small Worker (`worker/index.js`).

The `/docs/` pages aren't written here. They're synced from the kestrel repo at build time, so a fix to a guide belongs in kestrel's `docs/`, not in this repo.

## Develop

```bash
npm install
npm run serve   # hugo server at http://localhost:1313
```

That serves the landing page right away. To preview `/docs/` too, keep a Kestrel checkout at `~/Git/kestrel` or point `KESTREL_DOCS_SRC` at one. Without a checkout the site still builds, just without `/docs/`.

## More

How the docs sync and version pin work, how to bump to a new Kestrel release (the `refresh-from-kestrel` skill), running the contact form locally, how deploys run, and the repo conventions are all in [`.claude/CLAUDE.md`](.claude/CLAUDE.md).

## License

MIT © Kurt Bruns. See [LICENSE](LICENSE).
