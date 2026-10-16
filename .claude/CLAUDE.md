# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

How the site is built, the commands, how the docs pin works, the contact form, deploys, and the repo conventions are in `CONTRIBUTING.md`, the one copy for people and agents alike. It's imported here so it loads with this file:

@../CONTRIBUTING.md

The rest of this file is only what an agent needs on top of it.

## Bumping the pinned kestrel version

Bump `.kestrel-docs-version` only via the **`refresh-from-kestrel` skill**, never by hand — it catches the stale landing copy and screenshots a plain re-sync misses.

## The role model (before editing copy)

CONTRIBUTING names the three roles: publisher, developer, and reader. Getting them right is where copy edits go wrong, so check every role word you touch. PR #27 had to correct a bad `operator → publisher` edit to `operator → developer`. The skill's `SKILL.md` restates this where copy edits happen.
