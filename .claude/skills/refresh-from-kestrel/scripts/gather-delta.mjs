#!/usr/bin/env node
/*
 * refresh-from-kestrel: gather the old→new kestrel delta (issue #21).
 *
 * This is the deterministic evidence-gathering half of the skill. It reads two
 * kestrel tags and prints a report of FACTS; it never bumps the pin, edits the
 * site, or opens a PR. The judgement — which landing copy is now wrong, whether
 * the hero screenshot is stale — stays with the model, which weighs these facts
 * against the live landing page (layouts/index.html). See SKILL.md for that half.
 *
 * It answers three factual questions the bump turns on:
 *   1. What does the changelog say changed between the tags? (the INDEX)
 *   2. Did the rendered /docs/ pages actually change? (proven by running the
 *      real sync-docs.mjs against each tag and diffing its output — NOT by
 *      trusting the changelog. The v0.1.0→v0.2.0 case is the cautionary tale:
 *      the setup docs were byte-identical, so a docs-only view saw "nothing",
 *      yet the release carried a full editor-UI + spec delta.)
 *   3. What changed that the sync does NOT ingest? (docs/SPEC.md, docs/DESIGN.md
 *      — the DRILL-DOWN behind the changelog.)
 *
 * Mapping those facts onto the landing surfaces (and the screenshot call) is
 * deliberately NOT done here: it's the model's job, done by reading the live
 * layouts/index.html, because that judgement is the whole point of the skill
 * (see SKILL.md step 3).
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
import { join, relative } from "node:path";

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

// -------------------------------------------------------------- report
function fmtDiff(files, label) {
  if (!files.length) return `- ${label}: unchanged`;
  return `- ${label}:\n` + files.map((f) => `    ${f.path}  (+${f.added ?? "?"} / -${f.removed ?? "?"})`).join("\n");
}
function buildReport(d) {
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
    L.push(`→ The /docs/ section will not change from this bump. This is NOT permission to stop: the delta lives in the changelog, SPEC/DESIGN, and the editor UI (§1, §3). Re-check landing copy and the hero screenshot regardless (§4).`);
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

  L.push(`## 4. Now judge the landing — your job, against the live page`);
  L.push(`The script stops at facts. Open \`layouts/index.html\` (the always-current source of every landing claim) and read it section by section against §1 and §3. For each claim decide: still accurate, needs a copy edit, screenshot-stale, or no landing impact — filtered through the role model in SKILL.md, never a mechanical match.`);
  L.push(`Two checks are mandatory even when §2 says /docs/ is identical:`);
  L.push(`- **Landing copy** — does any claim in \`layouts/index.html\` now misdescribe kestrel?`);
  L.push(`- **Hero screenshot** — did any changelog entry change the editor/dashboard UI? If so the shipped \`assets/img/editor-*.png\` are suspect: regenerate with \`npm run shots\` (needs a seeded dev server at ${d.newRef}), or flag #19.`);
  L.push("");

  L.push(`## Next: the bump checklist`);
  L.push(`Continue with the checklist in SKILL.md — bump \`.kestrel-docs-version\`, re-sync, \`hugo\` build, give each landing section a verdict, then open a **draft** PR (never merge).`);
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
    // §1/§3 don't depend on rendering, so a render failure (no `tar`, a
    // sync-docs error, a bad archive) must degrade to a skipped §2, not abort
    // the whole report. The --no-render path already produces a usable report.
    let rendered = { ran: false, reason: "--no-render" };
    if (args.render) {
      try { rendered = renderedDocsComparison(kestrelDir, oldRef, newRef, repoRoot); }
      catch (err) { rendered = { ran: false, reason: `render step failed: ${err instanceof Error ? err.message : String(err)}` }; }
    }

    const data = { oldRef, newRef, kestrelSource: cloned ? `${kestrelDir} (fresh clone)` : kestrelDir, changelog, diff, rendered };
    const report = buildReport(data);
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
