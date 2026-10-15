#!/usr/bin/env node
/*
 * Docs ingestion (issue #3).
 *
 * Kestrel's setup guide is the single source of truth — it's also rendered
 * read-only inside the app. Rather than fork it into this repo, we sync it at
 * build time into a GITIGNORED content/docs/ tree, so no copy of that Markdown
 * is ever committed here.
 *
 * Two layouts, by the kestrel release pinned:
 *   - Sections (docs/README.md): the README is the landing page and the table of
 *     contents. Its H1 and intro head the /docs/ landing; each `##` heading is a
 *     section, with the paragraph under it as the section's blurb and a list of
 *     its pages, numbered when they are steps taken in order. Pages live in the
 *     section folders the README links (docs/get-started/02-deploy.md), and their
 *     slug is the file name without its NN- prefix, unique across sections.
 *     From kestrel 1.10.0 the docs are two sets, each with a README like that:
 *     Self-hosting (docs/README.md) at /docs/, and Publishing
 *     (docs/publishing/README.md, its pages beside it) at /docs/publishing/. A
 *     release without docs/publishing/ syncs Self-hosting alone.
 *   - Flat (docs/setup/NN-*.md): releases up to v1.2.0. Kept until the pin moves
 *     past them, so a sync of an older release still builds.
 *
 * The kestrel docs carry no Hugo front matter and derive their title from the
 * first `# H1`. This adds a light front-matter shim (title from the H1, weight
 * for order, the section and step for the landing) and strips the now-duplicated
 * H1, and it points the pages' relative links (`02-deploy.md#check-it`) at the
 * site's URLs — without editing the source Markdown. A page's screenshots live
 * beside it in kestrel (docs/publishing/img/editor.png, shown as `img/editor.png`);
 * they're copied to static/docs/ at the same path and each image is pointed at
 * its copy, /docs/publishing/img/editor.png. This shim is why we ingest
 * with a script rather than a Hugo Modules mount: a mount would carry the raw
 * Markdown, not this transform.
 *
 *   Source:  $KESTREL_DOCS_SRC (a kestrel checkout), default ~/Git/kestrel.
 *   Output:  content/docs/, and content/docs/publishing/  (gitignored)
 *            static/docs/, the docs' images              (gitignored)
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
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, posix } from "node:path";

const SRC = process.env.KESTREL_DOCS_SRC || join(homedir(), "Git", "kestrel");
const DOCS_DIR = join(SRC, "docs");
const INDEX = join(DOCS_DIR, "README.md");
const SETUP_DIR = join(DOCS_DIR, "setup");
const OUT = join(process.cwd(), "content", "docs");
// Hugo serves static/ at the site root, so an image here is at /docs/<its path under docs/>.
const IMG_OUT = join(process.cwd(), "static", "docs");
const IMAGE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

if (!existsSync(INDEX) && !existsSync(SETUP_DIR)) {
  console.warn(`[sync-docs] no kestrel docs at ${DOCS_DIR} — skipping. Set KESTREL_DOCS_SRC to a checkout, or ignore (the site builds without /docs/).`);
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
  // It's also the page's meta description, so keep whole sentences that fit: a
  // search snippet that stops mid-thought reads as cut off. Only a first sentence
  // too long on its own gets an ellipsis.
  if (text.length > 160) {
    const ends = [...text.matchAll(/[.!?](?=\s+[A-Z]|$)/g)].map((m) => m.index + 1).filter((i) => i <= 160);
    text = ends.length ? text.slice(0, ends.at(-1)) : text.slice(0, 158).replace(/\s+\S*$/, "") + "…";
  }
  return text;
}

function write(name, { title, weight, body, extra = "" }) {
  const fm = [`title: "${yamlEscape(title)}"`, `weight: ${weight}`, extra].filter(Boolean).join("\n");
  writeFileSync(join(OUT, name), `---\n${fm}\n---\n\n${normalizeHeadings(body)}\n`);
}

// Flat layout (docs/setup/NN-*.md, releases up to v1.2.0). /docs/ is an index:
// each numbered step is its own page, with a `title` and a plain-text
// `description` (for the index card) in the front matter.
function syncFlat() {
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
  return count;
}

// A page's path as its set's README links it: its section's folder, if the set
// has them, then the file (get-started/02-deploy.md, or 03-name-your-publication.md
// in Publishing). The slug drops the NN- prefix, and is unique across both sets.
const PAGE_PATH = /^(?:[a-z0-9-]+\/)?\d{2}-([a-z0-9-]+)\.md$/;
const slugOf = (path) => basename(path).match(/^\d{2}-(.+)\.md$/)[1];

// The two sets of kestrel 1.10.0 and later, each with its own README: Self-hosting
// (docs/README.md) is the /docs/ landing, and Publishing (docs/publishing/README.md)
// is a section under it at /docs/publishing/. `name` labels the set's tab.
const SETS = [
  { name: "Self-hosting", dir: "", url: "/docs/" },
  { name: "Publishing", dir: "publishing", url: "/docs/publishing/" },
];

// A heading's anchor, as GitHub (and kestrel's API) make it: a section's id.
const anchor = (s) => s.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");

/** Read a README: its title, its intro, and each section with its blurb, its
 *  numbering, and the pages it lists, in order. */
function readIndex(md) {
  let title = "";
  const intro = [];
  const sections = [];
  let inFence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; }
    if (inFence) { continue; }
    const cur = sections[sections.length - 1];
    let m;
    if (!title && (m = line.match(/^#\s+(.+?)\s*$/))) { title = m[1]; continue; }
    if ((m = line.match(/^##\s+(.+?)\s*$/))) {
      sections.push({ title: m[1], id: anchor(m[1]), blurb: [], numbered: false, pages: [] });
      continue;
    }
    const item = line.match(/^\s*(\d+\.|[-*])\s+.*?\]\(([^)]+)\)/);
    if (cur && item) {
      cur.numbered = /\d/.test(item[1]);
      if (PAGE_PATH.test(item[2])) { cur.pages.push(item[2]); }
      continue;
    }
    if (cur) {
      if (!cur.pages.length && (line.trim() || cur.blurb.length)) { cur.blurb.push(line); }
    } else if (title) {
      intro.push(line);
    }
  }
  const text = (lines) => lines.join("\n").trim();
  return { title, intro: text(intro), sections: sections.map((sec) => ({ ...sec, blurb: text(sec.blurb) })) };
}

/** Point relative links to another guide page or a set's README at the site's
 *  URLs, keeping any anchor: Hugo's heading ids follow GitHub's, as the app's do.
 *  `urls` maps a file's path under docs/ to its URL; `from` is the linking file's
 *  folder under docs/, so `../get-started/04-ses.md` from Publishing resolves. */
function rewriteLinks(md, urls, from) {
  return md
    .replace(/\]\(([^)#\s:]+\.md)(#[^)]*)?\)/g, (whole, target, hash) => {
      const url = urls.get(posix.normalize(posix.join(from, target)));
      return url ? `](${url}${hash ?? ""})` : whole;
    })
    // A relative image, at its copy under static/docs/ (copyImages).
    .replace(/(!\[[^\]]*\]\()([^)#\s:]+)(?=[)\s])/g, (whole, open, src) => {
      const path = posix.normalize(posix.join(from, src));
      return IMAGE.test(src) && !path.startsWith("../") ? `${open}/docs/${path}` : whole;
    });
}

/** Copy every image under docs/ to static/docs/ at the same path, where
 *  rewriteLinks points a page's images. Releases before kestrel 1.11 have none. */
function copyImages(dir = DOCS_DIR) {
  let count = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const src = join(dir, e.name);
    if (e.isDirectory()) {
      count += copyImages(src);
    } else if (IMAGE.test(e.name)) {
      const dest = join(IMG_OUT, src.slice(DOCS_DIR.length + 1));
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
      count++;
    }
  }
  return count;
}

// Sections layout (docs/README.md, and docs/publishing/README.md from kestrel
// 1.10.0). Each README is its set's landing: its title and intro, and its sections
// (with blurb and numbering) in the landing's front matter. Each page carries its
// section and, in a numbered section, its step.
function syncSections() {
  // A page belongs to the set whose folder it's in. Self-hosting's folder is docs/
  // itself, so a link there to publishing/01-your-list.md must not make that page
  // Self-hosting's too: it would be written twice, and take over the other's URL.
  const owner = (path) => SETS.filter((set) => !set.dir || path.startsWith(`${set.dir}/`)).at(-1);
  const sets = SETS.filter((set) => existsSync(join(DOCS_DIR, set.dir, "README.md"))).map((set) => {
    const index = readIndex(readFileSync(join(DOCS_DIR, set.dir, "README.md"), "utf8"));
    const pages = index.sections.flatMap((sec) =>
      sec.pages.map((path) => posix.join(set.dir, path)).filter((path) => {
        if (owner(path) === set) { return true; }
        console.warn(`[sync-docs] ${posix.join(set.dir, "README.md")} lists ${path}, a ${owner(path).name} page — skipping it in ${set.name}.`);
        return false;
      }).map((path, i) => ({ path, slug: slugOf(path), section: sec, step: sec.numbered ? i + 1 : 0 })));
    return { ...set, index, pages };
  });
  // Every file a link can name, across both sets, by its path under docs/.
  const urls = new Map();
  for (const set of sets) {
    urls.set(posix.join(set.dir, "README.md"), set.url);
    for (const p of set.pages) { urls.set(p.path, `${set.url}${p.slug}/`); }
  }
  let count = 0;
  for (const set of sets) {
    const out = join(OUT, set.dir);
    mkdirSync(out, { recursive: true });
    const sectionsYaml = set.index.sections.map((sec) => [
      `  - id: "${yamlEscape(sec.id)}"`,
      `    title: "${yamlEscape(sec.title)}"`,
      `    blurb: "${yamlEscape(rewriteLinks(sec.blurb, urls, set.dir).replace(/\s+/g, " "))}"`,
      `    numbered: ${sec.numbered}`,
    ].join("\n")).join("\n");
    writeFileSync(join(out, "_index.md"),
      `---\ntitle: "${yamlEscape(set.index.title)}"\ndescription: "${yamlEscape(firstPara(set.index.intro))}"\ndocset: "${set.name}"\nsections:\n${sectionsYaml}\n---\n\n${rewriteLinks(set.index.intro, urls, set.dir)}\n`);
    set.pages.forEach(({ path, slug, section, step }, i) => {
      const md = readFileSync(join(DOCS_DIR, path), "utf8");
      const extra = [
        `description: "${yamlEscape(firstPara(md))}"`,
        `docsection: "${yamlEscape(section.id)}"`,
        step ? `step: ${step}` : "",
      ].filter(Boolean).join("\n");
      write(join(set.dir, `${slug}.md`), { title: firstH1(md, slug), weight: i + 1, body: rewriteLinks(md, urls, posix.dirname(path)), extra });
    });
    count += set.pages.length;
  }
  return count;
}

const count = existsSync(INDEX) ? syncSections() : syncFlat();
// static/docs is gitignored and fully owned by this script too.
rmSync(IMG_OUT, { recursive: true, force: true });
const images = copyImages();

// The SPEC is intentionally not ingested — it lives in the (soon public)
// kestrel repo, and doesn't belong on the getkestrel.dev docs index.

console.log(`[sync-docs] wrote ${count} doc pages to content/docs/ and ${images} images to static/docs/ from ${SRC}`);
