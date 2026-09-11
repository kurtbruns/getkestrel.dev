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
const stripFirstH1 = (md) => md.replace(/^\s{0,3}#\s+.*(\r?\n)+/, "");

function write(name, { title, weight, body, extra = "" }) {
  const fm = [`title: "${yamlEscape(title)}"`, `weight: ${weight}`, extra].filter(Boolean).join("\n");
  writeFileSync(join(OUT, name), `---\n${fm}\n---\n\n${stripFirstH1(body).trimStart()}\n`);
}

let count = 0;
for (const file of readdirSync(SETUP_DIR).filter((f) => f.endsWith(".md")).sort()) {
  const md = readFileSync(join(SETUP_DIR, file), "utf8");
  const m = file.match(/^(\d+)-(.+)\.md$/);
  const weight = m ? parseInt(m[1], 10) : 50;
  const slug = m ? m[2] : basename(file, ".md");
  const title = firstH1(md, slug);
  // The lowest-numbered file (00-overview) becomes the section landing.
  write(weight === 0 ? "_index.md" : `${slug}.md`, { title, weight, body: md });
  count++;
}

if (existsSync(SPEC_FILE)) {
  write("spec.md", { title: "Specification", weight: 99, body: readFileSync(SPEC_FILE, "utf8") });
  count++;
}

console.log(`[sync-docs] wrote ${count} doc pages to content/docs/ from ${SRC}`);
