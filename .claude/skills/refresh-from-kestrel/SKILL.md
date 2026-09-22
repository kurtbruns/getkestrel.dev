---
name: refresh-from-kestrel
description: >-
  Bump getkestrel.dev's pinned kestrel version and reconcile the site with what
  actually changed in that release. Use this whenever kestrel cuts a new tag and
  the site should track it — "bump the kestrel docs version", "pin kestrel
  v0.3.0", "kestrel cut a release, update the site", "refresh /docs from
  kestrel", "advance .kestrel-docs-version". It reads the old→new changelog
  delta, re-syncs the docs, proves whether the rendered /docs/ actually changed,
  flags stale landing copy and a stale hero screenshot, and opens a DRAFT PR for
  review. Reach for it any time you edit .kestrel-docs-version by hand — the pin
  bump is the easy part; catching the copy and screenshots that silently went
  stale is the point.
---

# refresh-from-kestrel

The editorial layer on top of the docs pin. Bumping `.kestrel-docs-version` is a
one-line edit; this skill exists because that one line can silently make the
landing page lie — a screenshot goes stale, a concept gets renamed, a claim in
the copy stops being true — and a plain re-sync will never notice. Run it
deliberately at bump time, reason about the delta, and open a **draft** PR a
human reviews. It never merges.

## Inputs

- **New ref** (required): the kestrel tag to move to, e.g. `v0.3.0`. The user names it.
- **Old ref** (optional): defaults to the current pin in [`.kestrel-docs-version`](.kestrel-docs-version). Only pass it to diff a different starting point.

Work in a git worktree/branch off `main`, never on `main` directly.

## The role model — read this before you touch a word of copy

kestrel has three roles, and getkestrel.dev's copy depends on getting them right:

- **publisher** — writes and sends the newsletter.
- **developer** — deploys and operates the app on their own Cloudflare account. getkestrel.dev's `/docs/` are the **developer/setup guides**, and the landing's "self-host" framing addresses this person.
- **reader** — subscribes to and reads a newsletter.

kestrel retired the old word "operator" into publisher + developer. A mechanical
find-replace gets this wrong: PR #27 had to correct a bad `operator → publisher`
edit to `operator → developer`, because the setup docs are for the person
*running* the app. When a changelog entry names a role or a role-specific action,
decide which of the three it means before editing anything.

## Why "the setup docs didn't change" is never the whole answer

The trap this skill is built to avoid: the sync only ingests kestrel's
`docs/setup/*.md`. A release can leave those byte-identical while still shipping a
large, site-relevant delta everywhere the sync *doesn't* look — the changelog,
`docs/SPEC.md`, `docs/DESIGN.md`, and the editor UI the hero screenshot shows.

That is exactly what happened at `v0.1.0 → v0.2.0`: the setup docs were
byte-identical (so `/docs/` rendered identically), yet the release moved the
composer to `Edit | Preview` tabs, added dismissible dashboard notices, and
removed a dead status — none of which the sync ingests. A skill that stopped at
"docs unchanged" would have declared victory and shipped a stale hero shot.

So two checks are **mandatory on every run, even when `/docs/` is identical**:

1. **Changelog → landing-copy check** — does any claim in `layouts/index.html` now misdescribe kestrel?
2. **Screenshot-staleness check** — did the editor/dashboard UI change under the hero screenshot?

## Workflow

### 1. Gather the delta (the deterministic part)

Run the evidence-gatherer. It reads the two tags and prints a report — it never
bumps the pin, edits the site, or opens a PR. (Its one side effect: if a tag is
missing from your local kestrel checkout it runs `git fetch --tags` there; it
never touches this repo or any working tree.)

```bash
node .claude/skills/refresh-from-kestrel/scripts/gather-delta.mjs <newRef> [oldRef] --json /tmp/kestrel-delta.json
```

It uses your local kestrel checkout (`$KESTREL_DOCS_SRC` or `~/Git/kestrel`) and
falls back to a blobless clone if a tag is missing. The report is three factual
sections, then a pointer back to your judgement:

1. **Changelog delta** — every `## [x.y.z]` section in `(old, new]`. This is your INDEX of what changed.
2. **Rendered /docs/ comparison** — it runs the real `sync-docs.mjs` against *both* tags and diffs the output, so "unchanged" is proven, not assumed.
3. **Drill-down diff** — `docs/setup/` vs `docs/SPEC.md` / `docs/DESIGN.md`. The changelog is one line per change; SPEC/DESIGN are the detail behind it.

It stops at facts on purpose: mapping them onto the landing (step 3) is judgement
against the live page, not something a script should guess. Read the whole report
before doing anything.

### 2. Read the drill-down, not just the changelog

Consume **both** the index and the detail. For any changelog entry that could
touch a landing claim, open the actual diff to see what really changed:

```bash
git -C <kestrel-checkout> diff <oldRef>..<newRef> -- docs/SPEC.md docs/DESIGN.md
```

The changelog tells you *that* the send loop changed; SPEC tells you *how*, which
is what decides whether a sentence on the landing page is still true.

### 3. Judge the landing copy against the delta

`layouts/index.html` is the landing page and the only source of truth for what it
claims — read it directly, don't trust a cached list. (As it stands the page has a
hero with the app screenshot and a lead paragraph, the "You keep what matters"
ownership cards, the "write / preview / schedule / send" how-it-works flow, the
"Under the hood" tech-stack chips and engineering spec list, and the self-host
quickstart — but read the file, not this sentence.)

Go section by section. For each claim, weigh it against the changelog (§1) and the
SPEC/DESIGN drill-down (§2 above / the report's §3) and reach one verdict:

- **still accurate** — no edit.
- **needs a copy edit** — say what changed and make it, filtered through the role model above; a role word is a judgement, never a find-replace.
- **screenshot stale** — the editor/dashboard UI moved under the hero shot (see step 5).
- **no landing impact** — the change is internal, or a net-new feature the landing doesn't describe.

This is the whole reason a skill does this and a `sed` script cannot: whether a
claim is still true is a judgement, made by reading the real copy against the real
delta, not a keyword match. Two things to hold onto:

- **The screenshot is the easiest thing to miss** and the one a `/docs` re-sync will never catch. Any editor or dashboard UI change in the delta makes `assets/img/editor-*.png` suspect — treat it as its own mandatory check, not an afterthought.
- **Only fix copy that has become *wrong*, not copy that has become *incomplete*.** The landing describes what the app *is*, not its full feature list; new-feature marketing is a separate, deliberate decision (#5), not part of a version bump.

### 4. Bump the pin and prove the build

```bash
echo "<newRef>" > .kestrel-docs-version
# Re-sync /docs/ from the *new tag* so the local build matches CI/prod. Point the
# sync at a checkout at <newRef>; the reliable way (no need to move your working
# checkout) is to archive the tag into a temp dir, exactly as gather-delta does:
SRC="$(mktemp -d)"; git -C <kestrel-checkout> archive <newRef> docs | tar -x -C "$SRC"
KESTREL_DOCS_SRC="$SRC" npm run docs:sync
hugo --minify        # must build clean; note the page count
```

CI and prod clone the tag themselves (see `.github/workflows/`), so this local
build is a sanity check. `content/docs/` is gitignored and rebuilt by the sync — it is never committed.
The only tracked change from the pin bump itself is the one line in
`.kestrel-docs-version`, plus any copy edits you made in step 3 and any
screenshots from step 5.

### 5. Screenshots

If the delta changed the editor or dashboard UI (your reading of the changelog in
step 3), the hero screenshot is stale. Regenerating it needs a **running, seeded
kestrel dev server at the new ref** — see `scripts/shots.mjs`:

```bash
# in a kestrel checkout at <newRef>:
npm run dev && npm run seed
# then here:
npm run shots
```

If such a server is available in this run, regenerate and include the updated
`assets/img/*.png`. If it is **not** available, do not ship stale images and do
not block the pin bump — **flag it as a follow-up (#19)** and call it out in the
PR. Deferring the screenshot to its own change is the correct, honest outcome — it
is what the `v0.1.0 → v0.2.0` bump did.

### 6. Open a draft PR with a checklist

Commit on a branch and open a **draft** PR (`gh pr create --draft`). Never merge —
a human reviews it. Structure the body like the `v0.1.0 → v0.2.0` reconcile (the
golden fixture): say what moved, what the downstream impact is (and, deliberately,
where it is *none*), and what was deferred.

```markdown
## What
Advance `.kestrel-docs-version` from `<old>` to `<new>` — kestrel cut `<new>`.

## Downstream impact
- **Synced /docs/ pages:** <unchanged (byte-identical, proven by re-render) | changed: …>. Build clean (<N> pages).
- **Landing copy:** <re-checked against the changelog; still accurate | edited: …>.
  <the per-section verdicts from step 3>

## Follow-up (separate)
- <hero screenshot flagged stale (composer/dashboard changed) → #19, needs a running <new> dev server> — or "none".

## Provenance
Produced by the `refresh-from-kestrel` skill (#21). Draft for review; not auto-merged.
```

Include a checklist so the reviewer can see what was and wasn't done:

- [ ] `.kestrel-docs-version` bumped `<old>` → `<new>`
- [ ] `hugo --minify` builds clean
- [ ] rendered `/docs/` delta stated (unchanged / listed)
- [ ] every landing surface given a verdict against the changelog
- [ ] role model applied to any role/wording change
- [ ] screenshot: regenerated / flagged as follow-up / not needed
- [ ] opened as a **draft**, not merged

## Guardrails

- **Draft PR, human-reviewed, never auto-merged.** This skill produces a proposal.
- **Scope of edits:** `.kestrel-docs-version`, landing copy in `layouts/index.html`, and `assets/img/*` screenshots. `content/docs/` is gitignored — never commit it. Don't touch CI/deploy or the sync/shots scripts as part of a bump.
- **Do not rename `/docs/` → `/guides/`.** That is issue #15's separate, deliberate change; keep it out of a version bump.
- **Flag follow-ups against the right issue** — a stale hero screenshot is #19 — rather than inventing a number.
- **When the changelog and the diff disagree, trust the diff** — and when a claim's truth is genuinely unclear, flag it for the human rather than guessing.

## Files in this skill

- `SKILL.md` — this workflow: the role model, the mandatory copy + screenshot checks, and how to judge the live landing page.
- `scripts/gather-delta.mjs` — the deterministic evidence-gatherer (zero-dep, Node built-ins only; read-only for this repo — it never bumps the pin, edits the site, or opens a PR).

There is deliberately no landing "map" data file: `layouts/index.html` is the live source of truth for the copy, so the skill reads it directly rather than maintaining a second copy that could drift.
