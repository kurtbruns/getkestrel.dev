#!/usr/bin/env node
/*
 * TEMPORARY, DISSOLVABLE docs ingestion (issue #3).
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
 * the source Markdown.
 *
 *   Source:  $KESTREL_DOCS_SRC (a kestrel checkout), default ~/Git/kestrel.
 *   Output:  content/docs/  (gitignored)
 *
 * If the source isn't present (e.g. CI without a read token), this no-ops so
 * the site still builds — just without the /docs/ section. The Docs nav falls
 * back to GitHub in that case (see layouts/partials/header.html).
 *
 * DISSOLVE THIS when kestrel is public + tagged: replace the script with a
 * Hugo Modules mount of the pinned tag, drop content/docs/ from .gitignore,
 * and remove the CI "Sync operator docs" step. (issue #3)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const SRC = process.env.KESTREL_DOCS_SRC || join(homedir(), "Git", "kestrel");
const SETUP_DIR = join(SRC, "docs", "setup");
const SPEC_FILE = join(SRC, "docs", "SPEC.md");
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

function write(name, { title, weight, body, extra = "" }) {
  const fm = [`title: "${yamlEscape(title)}"`, `weight: ${weight}`, extra].filter(Boolean).join("\n");
  writeFileSync(join(OUT, name), `---\n${fm}\n---\n\n${normalizeHeadings(body)}\n`);
}

// The setup guide renders as ONE page at /docs/: the overview becomes the
// section landing (_index) and every numbered step is a "headless" page
// (render: never) that the /docs/ list template assembles inline as a section.
// So the guide is a single scroll with one Contents rail, not eight URLs.
const HEADLESS = "guide: true\nbuild:\n  render: never\n  list: local";
let count = 0;
for (const file of readdirSync(SETUP_DIR).filter((f) => f.endsWith(".md")).sort()) {
  const md = readFileSync(join(SETUP_DIR, file), "utf8");
  const m = file.match(/^(\d+)-(.+)\.md$/);
  const weight = m ? parseInt(m[1], 10) : 50;
  const slug = m ? m[2] : basename(file, ".md");
  const title = firstH1(md, slug);
  if (weight === 0) {
    write("_index.md", { title, weight, body: md });
  } else {
    write(`${slug}.md`, { title, weight, body: md, extra: HEADLESS });
  }
  count++;
}

if (existsSync(SPEC_FILE)) {
  write("spec.md", { title: "Specification", weight: 99, body: readFileSync(SPEC_FILE, "utf8") });
  count++;
}

console.log(`[sync-docs] wrote ${count} doc pages to content/docs/ from ${SRC}`);
