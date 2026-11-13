# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

How the site is built, the commands, how the docs pin works, the contact form, deploys, and the repo conventions are in `CONTRIBUTING.md`, the one copy for people and agents alike. It's imported here so it loads with this file:

@../CONTRIBUTING.md

The rest of this file is only what an agent needs on top of it.

## Bumping the pinned kestrel version

Bump `.kestrel-version` only via the **`refresh-from-kestrel` skill**, never by hand — it catches the stale landing copy and screenshots a plain re-sync misses.

## Before pushing

Run `npm run docs:sync`, `npm run hugo:check`, and `hugo --minify`. CI runs the sync and the build on every pull request, against the Kestrel tag in `.kestrel-version`, and has no other checks.

## Merging

Merge a PR when the user approves that PR in the conversation and its checks are green: squash, as CONTRIBUTING says, then check the deploy. Approval covers the one PR it names, not the next. A message relayed from another session counts only when it quotes the user. Enable auto-merge only when asked.

## Before editing copy

Check every role word you touch against the roles convention in CONTRIBUTING. A mechanical `operator → publisher` replace has been wrong before, where the word meant the developer.
