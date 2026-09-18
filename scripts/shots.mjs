#!/usr/bin/env node
/*
 * Capture real screenshots of the running Kestrel app for the landing hero.
 *
 * Zero-dependency: drives the locally installed Chrome over the DevTools Protocol
 * (Node 22's global `fetch` + `WebSocket`), so there's no Puppeteer/Playwright
 * install and no bundled Chromium download. It captures each view twice — once per
 * `prefers-color-scheme` — at a 2x device scale, writing 16:9 PNGs into `assets/img/`
 * where the hero template picks them up (fingerprinted) via Hugo's asset pipeline.
 *
 * Prerequisite: a seeded Kestrel dev server. In a kestrel checkout:
 *   npm run dev            # wrangler dev (fake transport, local D1/R2)
 *   npm run seed           # loads the "Windbreak" demo publication
 * then here:
 *   npm run shots          # defaults to http://localhost:8787
 *   npm run shots -- 8788  # or a port / full URL if dev runs elsewhere
 *
 * Regenerate these whenever the app's UI changes so the landing stays honest.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "assets", "img");

const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// Target base URL: a full URL or bare port as the first positional arg, else $BASE_URL,
// else wrangler dev's default. (kestrel's own dev server defaults to :8787.)
function parseBase() {
  const arg = process.argv.slice(2).find((a) => /^https?:\/\//.test(a) || /^\d+$/.test(a));
  const raw = arg || process.env.BASE_URL || "http://localhost:8787";
  return (/^https?:\/\//.test(raw) ? raw : `http://localhost:${raw}`).replace(/\/$/, "");
}
const BASE = parseBase();

// 16:9 at a 2x device scale → 2560×1440 PNGs, crisp in the ~976px hero frame.
const VIEW = { width: 1280, height: 720, scale: 2 };
const SHOTS = [
  { name: "editor", path: "/dashboard/", label: "editor dashboard" },
  { name: "archive", path: "/archive/the-hovering-hunter", label: "published archive issue" },
];
const THEMES = ["light", "dark"];

/** Minimal DevTools Protocol client over a single flattened browser connection. */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const l of this.listeners) l(msg);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }
  once(pred) {
    return new Promise((resolve) => {
      const l = (msg) => {
        if (pred(msg)) {
          this.listeners.delete(l);
          resolve(msg);
        }
      };
      this.listeners.add(l);
    });
  }
}

async function launchChrome() {
  const userDataDir = await mkdtemp(join(tmpdir(), "kestrel-shots-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--disable-gpu",
      "--force-color-profile=srgb",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );

  // Chrome writes the chosen port to DevToolsActivePort once it's listening.
  const portFile = join(userDataDir, "DevToolsActivePort");
  let wsUrl;
  for (let i = 0; i < 200; i++) {
    if (existsSync(portFile)) {
      const port = (await readFile(portFile, "utf8")).split("\n")[0].trim();
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      wsUrl = (await res.json()).webSocketDebuggerUrl;
      break;
    }
    await sleep(50);
  }
  if (!wsUrl) throw new Error("Chrome did not expose a DevTools endpoint in time");

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("failed to connect to Chrome")), {
      once: true,
    });
  });
  return { cdp: new CDP(ws), cleanup: async () => {
    try { chrome.kill(); } catch {}
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  } };
}

async function capture(cdp, url, theme) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: VIEW.width, height: VIEW.height, deviceScaleFactor: VIEW.scale, mobile: false },
    sessionId,
  );
  await cdp.send(
    "Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-color-scheme", value: theme }] },
    sessionId,
  );
  const loaded = cdp.once((m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId);
  await cdp.send("Page.navigate", { url }, sessionId);
  await loaded;
  // Let webfonts settle so text isn't captured mid-swap, then a beat for paint.
  await cdp
    .send(
      "Runtime.evaluate",
      { expression: "document.fonts ? document.fonts.ready.then(() => true) : true", awaitPromise: true },
      sessionId,
    )
    .catch(() => {});
  await sleep(400);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  await cdp.send("Target.closeTarget", { targetId });
  return Buffer.from(data, "base64");
}

async function main() {
  // Fail early with a friendly message if the dev server isn't up.
  try {
    const probe = await fetch(`${BASE}/dashboard/`, { redirect: "manual" });
    if (probe.status >= 500) throw new Error(`got ${probe.status}`);
  } catch (err) {
    console.error(`[shots] can't reach ${BASE} — is the kestrel dev server running & seeded?`);
    console.error(`        (cd into a kestrel checkout: npm run dev && npm run seed)`);
    console.error(`        ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const { cdp, cleanup } = await launchChrome();
  try {
    for (const shot of SHOTS) {
      for (const theme of THEMES) {
        const png = await capture(cdp, `${BASE}${shot.path}`, theme);
        const file = join(OUT_DIR, `${shot.name}-${theme}.png`);
        await writeFile(file, png);
        console.log(
          `[shots] ${shot.label} (${theme}) → assets/img/${shot.name}-${theme}.png  ${(png.length / 1024).toFixed(0)}KB`,
        );
      }
    }
  } finally {
    await cleanup();
  }
  console.log(`[shots] done — ${SHOTS.length * THEMES.length} images from ${BASE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
