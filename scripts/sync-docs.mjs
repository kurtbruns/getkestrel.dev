#!/usr/bin/env node
/*
 * Docs ingestion (issue #3).
 *
 * Kestrel's operator docs (docs/setup/*.md + docs/SPEC.md) are the single
 * source of truth — they're also rendered read-only inside the app. Rather
 * than fork them into this repo, we sync them at build time into a GITIGNORED
 * content/docs/ tree, so no copy of that Markdown is ever committed here.
 *
 * The kestrel docs carry no Hugo front matter and derive their title from the
 * first `# H1`, and the setup files are ordered by an `NN-` filename prefix.
 * This adds a light front-matter shim (title from the H1, weight from the
 * prefix for menu order) and strips the now-duplicated H1 — without editing
 * the source Markdown. This shim is why we ingest with a script rather than a
 * Hugo Modules mount: a mount would carry the raw Markdown, not this transform.
 *
 *   Source:  $KESTREL_DOCS_SRC (a kestrel checkout), default ~/Git/kestrel.
 *   Output:  content/docs/  (gitignored)
 *
 * Which kestrel to point at is decided outside this script, and the two paths
 * differ on purpose: CI/prod (ci.yml, deploy.yml) clone the release tag pinned
 * in .kestrel-docs-version, so the live site only moves when that file is
 * bumped; local dev reads a local checkout (default ~/Git/kestrel, override
 * with $KESTREL_DOCS_SRC) so you can preview against uncommitted doc changes.
 *
 * If the source isn't present, this no-ops so the site still builds — just
 * without the /docs/ section. The Docs nav falls back to GitHub in that case
 * (see layouts/partials/header.html).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SRC = process.env.KESTREL_DOCS_SRC || join(homedir(), "Git", "kestrel");
const SETUP_DIR = join(SRC, "docs", "setup");
const OUT = join(process.cwd(), "content", "docs");

if (!existsSync(SETUP_DIR)) {
  console.warn(`[sync-docs] no kestrel docs at ${SETUP_DIR} — skipping. Set KESTREL_DOCS_SRC to a checkout, or ignore (the site builds without /docs/).`);
  process.exit(0);
}

// content/docs is gitignored and fully owned by this script — rebuild it clean.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const yamlEscape = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const firstH1 = (md, fallback) => {
  const m = md.match(/^\s{0,3}#\s+(.+?)\s*$/m);
  return m ? m[1].trim() : fallback;
};
// Drop the first H1 (it becomes the page title) and demote any remaining H1
// to H2, so a doc that uses `# Appendix` mid-body doesn't leave stray H1s that
// break the heading tree / Contents rail. Fence-aware: never touches a `#`
// comment inside a ``` / ~~~ code block.
function normalizeHeadings(md) {
  const out = [];
  let inFence = false, droppedTitle = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; out.push(line); continue; }
    if (!inFence && /^\s{0,3}#\s+/.test(line)) {
      if (!droppedTitle) { droppedTitle = true; continue; }
      out.push(line.replace(/^(\s{0,3})#\s+/, "$1## "));
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/^\s+/, "");
}

// The first real paragraph, flattened to plain text — the blurb the /docs/
// index shows under each doc's title. Skips the title, headings, code fences,
// and any leading list/table/quote.
function firstPara(md) {
  const body = md.replace(/^\s{0,3}#\s+.*(\r?\n)+/, "");
  const para = [];
  let started = false, inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { if (started) break; inFence = !inFence; continue; }
    if (inFence) { continue; }
    if (/^\s*$/.test(line)) { if (started) break; else continue; }
    if (/^\s{0,3}#|^\s*[-*>|]/.test(line)) { if (started) break; else continue; }
    started = true; para.push(line.trim());
  }
  let text = para.join(" ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\*([^*]*)\*/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > 150) { text = text.slice(0, 148).replace(/\s+\S*$/, "") + "…"; }
  return text;
}

function write(name, { title, weight, body, extra = "" }) {
  const fm = [`title: "${yamlEscape(title)}"`, `weight: ${weight}`, extra].filter(Boolean).join("\n");
  writeFileSync(join(OUT, name), `---\n${fm}\n---\n\n${normalizeHeadings(body)}\n`);
}

// /docs/ is an index: the overview becomes the section landing (_index) that
// lists the docs, and each numbered step + the spec is its own page. A `title`
// and a plain-text `description` (for the index card) go in the front matter.
// The /docs/ landing: a short lede over the doc cards (the overview doc
// itself becomes the first card, not the whole landing).
writeFileSync(join(OUT, "_index.md"),
  `---\ntitle: "Documentation"\n---\n\nHow to take Kestrel from a cloned repo to a live newsletter — the run-once, out-of-band steps against your own Cloudflare account, DNS, and email provider.\n`);

let count = 1;
for (const file of readdirSync(SETUP_DIR).filter((f) => f.endsWith(".md")).sort()) {
  const md = readFileSync(join(SETUP_DIR, file), "utf8");
  const m = file.match(/^(\d+)-(.+)\.md$/);
  // +1 so the overview (00) isn't weight 0, which Hugo treats as unset and
  // sorts last. Numbering then runs 01…07 across the setup docs.
  const weight = m ? parseInt(m[1], 10) + 1 : 50;
  const slug = m ? m[2] : basename(file, ".md");
  const title = firstH1(md, slug);
  write(`${slug}.md`, { title, weight, body: md, extra: `description: "${yamlEscape(firstPara(md))}"` });
  count++;
}

// The SPEC is intentionally not ingested — it lives in the (soon public)
// kestrel repo, and doesn't belong on the getkestrel.dev docs index.

console.log(`[sync-docs] wrote ${count} doc pages to content/docs/ from ${SRC}`);
