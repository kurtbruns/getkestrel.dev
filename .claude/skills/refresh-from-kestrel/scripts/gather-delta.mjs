#!/usr/bin/env node
/*
 * refresh-from-kestrel: gather the old→new kestrel delta (issue #21).
 *
 * This is the deterministic evidence-gathering half of the skill. It does NOT
 * bump anything, touch the working tree, or open a PR — it reads two kestrel
 * tags and prints a report the skill reasons over. The editorial judgement
 * (which landing copy is now wrong) stays with the model; see the skill's
 * SKILL.md and references/landing-map.json.
 *
 * It answers four questions the bump has to get right:
 *   1. What does the changelog say changed between the tags? (the INDEX)
 *   2. Did the rendered /docs/ pages actually change? (proven by running the
 *      real sync-docs.mjs against each tag and diffing its output — NOT by
 *      trusting the changelog. The v0.1.0→v0.2.0 case is the cautionary tale:
 *      the setup docs were byte-identical, so a docs-only view saw "nothing",
 *      yet the release carried a full editor-UI + spec delta.)
 *   3. What changed that the sync does NOT ingest? (docs/SPEC.md, docs/DESIGN.md
 *      — the DRILL-DOWN behind the changelog.)
 *   4. Which landing surfaces might now be stale? (candidate hints from the
 *      landing map + an editor/dashboard-UI signal for screenshot staleness.)
 *
 * Usage:
 *   node .claude/skills/refresh-from-kestrel/scripts/gather-delta.mjs <newRef> [oldRef]
 *   node .../gather-delta.mjs v0.2.0                 # oldRef defaults to .kestrel-docs-version
 *   node .../gather-delta.mjs v0.2.0 v0.1.0
 *   node .../gather-delta.mjs v0.2.0 --json report.json --no-render
 *
 * Options:
 *   --src <dir>    kestrel checkout to read (default: $KESTREL_DOCS_SRC or ~/Git/kestrel;
 *                  falls back to a blobless clone of kurtbruns/kestrel if refs are missing).
 *   --repo <dir>   getkestrel.dev root (default: cwd) — for sync-docs.mjs and .kestrel-docs-version.
 *   --json <path>  also write the structured report as JSON.
 *   --no-render    skip the render-and-diff of /docs/ (question 2). Faster, less proof.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = join(SKILL_DIR, "references", "landing-map.json");

// ---------------------------------------------------------------- args
function parseArgs(argv) {
  const out = { positional: [], render: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--no-render") out.render = false;
    else if (a === "--src") out.src = argv[++i];
    else if (a === "--repo") out.repo = argv[++i];
    else if (a === "--json") out.json = argv[++i];
    else if (a.startsWith("--")) fail(`unknown option: ${a}`);
    else out.positional.push(a);
  }
  return out;
}
function fail(msg) {
  console.error(`[gather-delta] ${msg}`);
  process.exit(1);
}
// stderr is ignored: the resolve path probes refs with `rev-parse --verify` and
// expects some to fail (a local checkout behind on tags), so git's "fatal:
// Needed a single revision" is normal control flow, not noise worth printing.
const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
const gitOk = (dir, args) => { try { git(dir, args); return true; } catch { return false; } };

// -------------------------------------------------------------- resolve
function resolveKestrel(preferred, needRefs) {
  const candidate = preferred || process.env.KESTREL_DOCS_SRC || join(homedir(), "Git", "kestrel");
  if (existsSync(join(candidate, ".git")) || gitOk(candidate, ["rev-parse", "--git-dir"])) {
    // Make sure the tags are present; a local checkout may be behind.
    if (!needRefs.every((r) => gitOk(candidate, ["rev-parse", "--verify", `${r}^{commit}`]))) {
      gitOk(candidate, ["fetch", "--tags", "--quiet"]);
    }
    const missing = needRefs.filter((r) => !gitOk(candidate, ["rev-parse", "--verify", `${r}^{commit}`]));
    if (!missing.length) {
      return { dir: candidate, cloned: false };
    }
    console.error(`[gather-delta] ${candidate} is missing ${missing.join(" / ")}; cloning kestrel instead.`);
  } else {
    console.error(`[gather-delta] no kestrel checkout at ${candidate}; cloning kurtbruns/kestrel.`);
  }
  const tmp = mkdtempSync(join(tmpdir(), "kestrel-delta-"));
  const url = "https://github.com/kurtbruns/kestrel.git";
  execFileSync("git", ["clone", "--filter=blob:none", "--quiet", url, tmp], { stdio: ["ignore", "ignore", "inherit"] });
  gitOk(tmp, ["fetch", "--tags", "--quiet"]);
  for (const r of needRefs) {
    if (!gitOk(tmp, ["rev-parse", "--verify", `${r}^{commit}`])) fail(`ref ${r} not found in kestrel even after cloning — is it a real tag?`);
  }
  return { dir: tmp, cloned: true, tmp };
}

// ------------------------------------------------------------ changelog
const bareVersion = (ref) => ref.replace(/^v/, "").trim();
function cmpSemver(a, b) {
  const pa = bareVersion(a).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = bareVersion(b).split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

/** Collect the changelog sections for every version in (old, new], newest first. */
function changelogDelta(kestrelDir, oldRef, newRef) {
  let raw;
  try { raw = git(kestrelDir, ["show", `${newRef}:CHANGELOG.md`]); }
  catch { return { found: false, sections: [], text: "(no CHANGELOG.md at " + newRef + ")" }; }
  const lines = raw.split(/\r?\n/);
  const heads = [];
  lines.forEach((line, i) => {
    const m = line.match(/^##\s+\[([^\]]+)\]/);
    if (m) heads.push({ version: m[1], line: i });
  });
  const sections = [];
  for (let h = 0; h < heads.length; h++) {
    const { version } = heads[h];
    if (!/^\d+\.\d+\.\d+/.test(version)) continue; // skip [Unreleased]
    const end = h + 1 < heads.length ? heads[h + 1].line : lines.length;
    // In the delta window? version > old AND version <= new.
    if (cmpSemver(version, oldRef) > 0 && cmpSemver(version, newRef) <= 0) {
      let text = lines.slice(heads[h].line, end).join("\n").replace(/\s+$/, "");
      sections.push({ version, text });
    }
  }
  return { found: sections.length > 0, sections, text: raw };
}

// --------------------------------------------------------------- diffs
function diffFiles(kestrelDir, oldRef, newRef, paths) {
  let out = "";
  try { out = git(kestrelDir, ["diff", "--numstat", `${oldRef}..${newRef}`, "--", ...paths]); }
  catch { return []; }
  return out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [added, removed, path] = l.split("\t");
    return { path, added: added === "-" ? null : parseInt(added, 10), removed: removed === "-" ? null : parseInt(removed, 10) };
  });
}

// --------------------------------------------------- rendered /docs diff
function walk(root) {
  const files = {};
  const rec = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) rec(p);
      else files[relative(root, p)] = readFileSync(p, "utf8");
    }
  };
  if (existsSync(root)) rec(root);
  return files;
}
function renderDocsAt(kestrelDir, ref, syncScript, tmpRoot) {
  const tag = ref.replace(/[^\w.-]/g, "_");
  const srcDir = join(tmpRoot, `src-${tag}`);
  const renderDir = join(tmpRoot, `render-${tag}`);
  mkdirSync(srcDir, { recursive: true });
  mkdirSync(renderDir, { recursive: true });
  // Archive just docs/ at the ref (never touches the checkout's working tree).
  const tarball = execFileSync("git", ["-C", kestrelDir, "archive", ref, "docs"], { maxBuffer: 256 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", srcDir], { input: tarball });
  execFileSync("node", [syncScript], { cwd: renderDir, env: { ...process.env, KESTREL_DOCS_SRC: srcDir }, stdio: ["ignore", "ignore", "inherit"] });
  return join(renderDir, "content", "docs");
}
function renderedDocsComparison(kestrelDir, oldRef, newRef, repoRoot) {
  const syncScript = join(repoRoot, "scripts", "sync-docs.mjs");
  if (!existsSync(syncScript)) return { ran: false, reason: `no sync-docs.mjs at ${syncScript}` };
  const tmpRoot = mkdtempSync(join(tmpdir(), "kestrel-render-"));
  try {
    const oldDocs = walk(renderDocsAt(kestrelDir, oldRef, syncScript, tmpRoot));
    const newDocs = walk(renderDocsAt(kestrelDir, newRef, syncScript, tmpRoot));
    const names = new Set([...Object.keys(oldDocs), ...Object.keys(newDocs)]);
    const added = [], removed = [], changed = [];
    for (const n of names) {
      if (!(n in oldDocs)) added.push(n);
      else if (!(n in newDocs)) removed.push(n);
      else if (oldDocs[n] !== newDocs[n]) changed.push(n);
    }
    const pageCount = Object.keys(newDocs).length;
    // Guard against a hollow all-clear: zero pages on both sides diffs as
    // "identical" but actually means the sync produced nothing (e.g. an empty
    // docs/setup at the ref), which proves nothing — surface it instead.
    const identical = pageCount > 0 && !added.length && !removed.length && !changed.length;
    return { ran: true, identical, empty: pageCount === 0, added, removed, changed, pageCount };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ------------------------------------------------------ candidate hints
function bulletLines(sections) {
  const lines = [];
  for (const s of sections) {
    for (const line of s.text.split(/\r?\n/)) {
      if (/^\s*[-*]\s+/.test(line)) lines.push(line.replace(/^\s*[-*]\s+/, "").trim());
    }
  }
  return lines;
}
// Match a keyword as a whole token, not a raw substring — so "ses" doesn't fire
// on "pulses" and "ui" doesn't fire on "rebuilt". Letters and digits are the
// word characters; punctuation (/, -, :, .) is a boundary, so "d1", "if-match",
// "npm run dev", and "SES" all match the way an editor would expect.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function matchesKeyword(text, keyword) {
  return new RegExp(`(?<![a-z0-9])${esc(keyword.toLowerCase())}(?![a-z0-9])`, "i").test(text);
}
function candidateHints(map, sections) {
  const bullets = bulletLines(sections);
  const perSurface = {};
  for (const surf of map.surfaces) {
    const hits = [];
    for (const line of bullets) {
      const matched = surf.keywords.filter((k) => matchesKeyword(line, k));
      if (matched.length) hits.push({ line, matched });
    }
    if (hits.length) perSurface[surf.id] = hits;
  }
  return perSurface;
}
// Editor/dashboard UI signal → screenshot staleness. Reuse the hero-screenshot
// surface's keywords as the definition of "UI-ish".
function uiSignal(map, sections) {
  const screen = map.surfaces.find((s) => s.id === "hero-screenshot");
  const kws = screen ? screen.keywords : [];
  const lines = bulletLines(sections)
    .map((line) => ({ line, matched: kws.filter((k) => matchesKeyword(line, k)) }))
    .filter((h) => h.matched.length);
  return { hit: lines.length > 0, lines };
}

// -------------------------------------------------------------- report
function fmtDiff(files, label) {
  if (!files.length) return `- ${label}: unchanged`;
  return `- ${label}:\n` + files.map((f) => `    ${f.path}  (+${f.added ?? "?"} / -${f.removed ?? "?"})`).join("\n");
}
function buildReport(d, map) {
  const L = [];
  L.push(`# refresh-from-kestrel — delta report: ${d.oldRef} → ${d.newRef}`);
  L.push("");
  L.push(`Old ref (current pin): \`${d.oldRef}\`  ·  New ref: \`${d.newRef}\`  ·  kestrel source: ${d.kestrelSource}`);
  L.push("");

  L.push(`## 1. Changelog delta — the index of what changed`);
  if (!d.changelog.found) {
    L.push(`> No \`## [${bareVersion(d.newRef)}]\` section found in CHANGELOG.md at ${d.newRef}. Check the tag, or that kestrel cut the release section.`);
  } else {
    for (const s of d.changelog.sections) { L.push(""); L.push(s.text); }
  }
  L.push("");

  L.push(`## 2. Rendered /docs/ comparison — did the synced pages actually change?`);
  if (!d.rendered.ran) {
    L.push(`> Skipped (${d.rendered.reason || "--no-render"}). Fall back to the setup-docs diff in §3.`);
  } else if (d.rendered.empty) {
    L.push(`> The sync produced **0 pages** at ${d.newRef} — nothing to compare, so this proves nothing. Check that \`docs/setup/\` exists at the ref, then rely on the setup-docs diff in §3.`);
  } else if (d.rendered.identical) {
    L.push(`**Identical.** Running sync-docs.mjs against both tags produced byte-identical \`content/docs/\` (${d.rendered.pageCount} pages).`);
    L.push(`→ The /docs/ section will not change from this bump. This is NOT permission to stop: the delta lives in the changelog, SPEC/DESIGN, and the editor UI (§1, §3, §4). Re-check landing copy and the hero screenshot regardless.`);
  } else {
    L.push(`**Changed.** The synced \`content/docs/\` differs between the tags:`);
    if (d.rendered.added.length) L.push(`- new pages: ${d.rendered.added.join(", ")}`);
    if (d.rendered.removed.length) L.push(`- removed pages: ${d.rendered.removed.join(", ")}`);
    if (d.rendered.changed.length) L.push(`- changed pages: ${d.rendered.changed.join(", ")}`);
  }
  L.push("");

  L.push(`## 3. Drill-down diff — what the sync does NOT ingest`);
  L.push(`The sync only ingests \`docs/setup/*.md\`. SPEC/DESIGN and everything else are the drill-down behind the changelog — read them to turn a one-line entry into an actual copy verdict.`);
  L.push(fmtDiff(d.diff.setup, "docs/setup/ (feeds the synced /docs/ pages)"));
  L.push(fmtDiff(d.diff.spec, "docs/SPEC.md"));
  L.push(fmtDiff(d.diff.design, "docs/DESIGN.md"));
  L.push(fmtDiff(d.diff.other, "other docs/"));
  L.push(`- full text: \`git -C ${d.kestrelSource} diff ${d.oldRef}..${d.newRef} -- docs/\``);
  L.push("");

  L.push(`## 4. Screenshot staleness signal`);
  if (d.ui.hit) {
    L.push(`**Editor/dashboard UI keywords appear in the delta → the hero screenshot is SUSPECT.**`);
    L.push(`assets/img/editor-{light,dark}.png (and archive-*) may no longer match ${d.newRef}. Lines that triggered this:`);
    for (const h of d.ui.lines) L.push(`- ${h.line}   _[matched: ${h.matched.join(", ")}]_`);
    const regen = (map.surfaces.find((s) => s.id === "hero-screenshot") || {}).regen || {};
    L.push(`Regenerate with \`${regen.command || "npm run shots"}\` — ${regen.prerequisite || "needs a running, seeded kestrel dev server at the new ref."}`);
    L.push(`If no such dev server is available in this run, FLAG it as a follow-up (issue #${regen.followUpIssue || 19}) rather than shipping stale images.`);
  } else {
    L.push(`No editor/dashboard UI keywords in the delta. The hero screenshot is likely still accurate — confirm against §1 anyway.`);
  }
  L.push("");

  L.push(`## 5. Landing-surface candidates — VERIFY, these are hints not verdicts`);
  L.push(`Each changelog line below mentions a keyword tied to a landing surface. A hit means "go read the copy and decide", not "edit it". Use the role model and the exact wording in layouts/index.html (see references/landing-map.json).`);
  const ids = map.surfaces.map((s) => s.id);
  const hitIds = Object.keys(d.candidates);
  for (const id of ids) {
    if (!d.candidates[id]) continue;
    const surf = map.surfaces.find((s) => s.id === id);
    L.push("");
    L.push(`### ${id} — ${surf.label}`);
    L.push(`source: ${surf.source}`);
    for (const h of d.candidates[id]) L.push(`- ${h.line}   _[matched: ${h.matched.join(", ")}]_`);
  }
  const noHits = ids.filter((id) => !hitIds.includes(id));
  if (noHits.length) { L.push(""); L.push(`Surfaces with no keyword hits (still worth a glance if a change is subtle): ${noHits.join(", ")}`); }
  L.push("");

  L.push(`## Next: the bump checklist`);
  L.push(`Continue with the checklist in SKILL.md — bump \`.kestrel-docs-version\`, re-sync, \`hugo\` build, decide each surface above, then open a **draft** PR (never merge).`);
  return L.join("\n") + "\n";
}

// ---------------------------------------------------------------- main
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.positional.length) fail("need a new ref, e.g. `gather-delta.mjs v0.2.0`");
  const repoRoot = args.repo || process.cwd();
  const newRef = args.positional[0];
  let oldRef = args.positional[1];
  if (!oldRef) {
    const pinFile = join(repoRoot, ".kestrel-docs-version");
    if (!existsSync(pinFile)) fail(`no old ref given and no .kestrel-docs-version at ${pinFile}`);
    oldRef = readFileSync(pinFile, "utf8").trim();
  }
  if (cmpSemver(newRef, oldRef) <= 0) console.error(`[gather-delta] warning: new ref ${newRef} is not newer than old ref ${oldRef}.`);

  const map = JSON.parse(readFileSync(MAP_PATH, "utf8"));
  const { dir: kestrelDir, cloned, tmp } = resolveKestrel(args.src, [oldRef, newRef]);

  try {
    const changelog = changelogDelta(kestrelDir, oldRef, newRef);
    const allDiff = diffFiles(kestrelDir, oldRef, newRef, ["docs/", "SPEC/", "DESIGN/", "SPEC.md", "DESIGN.md"]);
    const diff = {
      setup: allDiff.filter((f) => f.path.startsWith("docs/setup/")),
      spec: allDiff.filter((f) => /(^|\/)SPEC\.md$/.test(f.path)),
      design: allDiff.filter((f) => /(^|\/)DESIGN\.md$/.test(f.path)),
      other: allDiff.filter((f) => f.path.startsWith("docs/") && !f.path.startsWith("docs/setup/") && !/DESIGN\.md$|SPEC\.md$/.test(f.path)),
    };
    // §1/§3/§4/§5 don't depend on rendering, so a render failure (no `tar`, a
    // sync-docs error, a bad archive) must degrade to a skipped §2, not abort
    // the whole report. The --no-render path already produces a usable report.
    let rendered = { ran: false, reason: "--no-render" };
    if (args.render) {
      try { rendered = renderedDocsComparison(kestrelDir, oldRef, newRef, repoRoot); }
      catch (err) { rendered = { ran: false, reason: `render step failed: ${err instanceof Error ? err.message : String(err)}` }; }
    }
    const ui = uiSignal(map, changelog.sections);
    const candidates = candidateHints(map, changelog.sections);

    const data = { oldRef, newRef, kestrelSource: cloned ? `${kestrelDir} (fresh clone)` : kestrelDir, changelog, diff, rendered, ui, candidates };
    const report = buildReport(data, map);
    process.stdout.write(report);
    if (args.json) {
      writeFileSync(args.json, JSON.stringify(data, null, 2));
      console.error(`[gather-delta] structured report → ${args.json}`);
    }
  } finally {
    if (cloned && tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

main();
