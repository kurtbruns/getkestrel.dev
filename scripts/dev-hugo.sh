#!/usr/bin/env bash
# Wrapper so `hugo server` honors the PORT env var. Claude Code's launch.json
# autoPort sets $PORT when it relocates off a busy 1313, but Hugo only takes
# --port, so the indirection lives here. Falls back to 1313 for a plain run
# (a bare terminal `npm run serve` or `bash scripts/dev-hugo.sh`).
#
# `exec` replaces this shell with hugo so Ctrl-C and stop signals reach hugo
# directly instead of an intermediate bash, leaving no orphaned server on the
# port.
#
# --renderToMemory keeps the dev server out of public/. Since Hugo 0.124 the
# server writes and serves from public/ by default, which collides two ways: a
# `hugo --minify` production build (e.g. `npm run dev:worker`) overwrites
# public/ with fingerprinted prod output, and two servers in different git
# worktrees would fight over the same directory. Rendering to memory gives each
# server a private filesystem, so public/ belongs to `hugo`/wrangler alone.
#
# The Hugo version is pinned in .tool-versions (asdf), so this runs the same
# version the deploy does. Extra flags (e.g. --disableFastRender) passed after
# the script name are forwarded straight through to hugo server.
set -eu

# Sync the kestrel developer docs into content/docs/ before serving (best-effort:
# no-ops if the source checkout isn't present). Local dev reads a local kestrel
# checkout (default ~/Git/kestrel, override with $KESTREL_DOCS_SRC), so you see
# your working docs; CI/prod instead pin the release tag in .kestrel-docs-version.
# See scripts/sync-docs.mjs.
node scripts/sync-docs.mjs || true

exec hugo server --renderToMemory --port "${PORT:-1313}" "$@"
