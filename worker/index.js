/*
 * getkestrel.dev's one dynamic route: the contact form at /contact/ posts here.
 *
 * Everything else on the site is static (Hugo's output, served as Workers Static
 * Assets). wrangler.jsonc's `run_worker_first` sends only /api/ paths and /docs to
 * this script, so the other pages never pay for it; anything else that reaches it is
 * handed back to the assets.
 *
 * /docs comes here so an agent can ask for a page as Markdown (issue #66): a request
 * for /docs/deploy/ that prefers `text/markdown` gets the page's Markdown copy,
 * /docs/deploy.md, which scripts/sync-docs.mjs writes. Both answers say `Vary: Accept`,
 * so a cache keeps them apart, and the Markdown names its HTML page as canonical.
 *
 * A message is checked by Turnstile, then emailed to the site's owner through
 * Cloudflare's `send_email` binding. Sending to a destination address verified in the
 * account is free on every plan, so this needs no email provider of its own. The
 * visitor's address goes in Reply-To, so answering is a plain reply.
 *
 * The form works without JavaScript: every outcome is a 303 back to a page, the
 * confirmation at /contact/sent/ or the form with an `?error=` the page explains.
 */

const LIMITS = { name: 200, email: 320, message: 5000 };
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/contact") {
      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
      }
      return contact(request, env, url);
    }
    if (url.pathname === "/docs" || url.pathname.startsWith("/docs/") || url.pathname === "/docs.md") {
      return docs(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};

/** A docs page as the request prefers it: its HTML, or its Markdown copy when the
 *  request asks for Markdown and the page has one. A Markdown copy asked for by its own
 *  URL is served as it is, naming its HTML page as canonical. */
async function docs(request, env, url) {
  if (url.pathname.endsWith(".md")) {
    return canonical(await env.ASSETS.fetch(request), url, url.pathname);
  }
  if (prefersMarkdown(request.headers.get("Accept"))) {
    const md = `${url.pathname.replace(/\/$/, "")}.md`;
    const res = await env.ASSETS.fetch(new Request(new URL(md, url.origin), request));
    if (res.ok) {
      const out = canonical(res, url, md);
      out.headers.set("Content-Location", md);
      out.headers.append("Vary", "Accept");
      return out;
    }
  }
  // The HTML, or whatever the assets answer (a redirect from _redirects, the 404 page).
  const html = await env.ASSETS.fetch(request);
  const res = new Response(html.body, html);
  res.headers.append("Vary", "Accept");
  return res;
}

/** Whether an Accept header prefers Markdown to HTML: `text/markdown` with a weight
 *  above zero and no lower than `text/html`'s. Claude Code sends
 *  `text/markdown, text/html, *\/*`, a tie, which goes to Markdown; a browser never
 *  names `text/markdown`, so it keeps getting HTML. */
function prefersMarkdown(accept) {
  const weight = (type) => {
    for (const part of (accept ?? "").split(",")) {
      const [range, ...params] = part.trim().toLowerCase().split(";");
      if (range.trim() !== type) {
        continue;
      }
      const q = params.map((p) => p.trim().match(/^q=([\d.]+)$/)).find(Boolean);
      return q ? Number(q[1]) : 1;
    }
    return 0;
  };
  const md = weight("text/markdown");
  return md > 0 && md >= weight("text/html");
}

/** A Markdown copy's response, with a `Link` naming its HTML page (the copy's path with a
 *  trailing slash in place of `.md`) as canonical, so it isn't indexed as a second page. */
function canonical(res, url, mdPath) {
  const out = new Response(res.body, res);
  if (res.ok) {
    out.headers.set("Link", `<${url.origin}${mdPath.replace(/\.md$/, "/")}>; rel="canonical"`);
  }
  return out;
}

async function contact(request, env, url) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return back(url, "/contact/?error=form");
  }
  const field = (name) => String(form.get(name) ?? "").trim();

  // A field people never see. A bot that fills it is told it succeeded, so it learns
  // nothing, and nothing is sent.
  if (field("website")) {
    return back(url, "/contact/sent/");
  }

  const name = field("name");
  const email = field("email");
  const message = field("message");
  if (
    !EMAIL.test(email) ||
    !message ||
    name.length > LIMITS.name ||
    email.length > LIMITS.email ||
    message.length > LIMITS.message
  ) {
    return back(url, "/contact/?error=fields");
  }

  if (!(await human(field("cf-turnstile-response"), request, env))) {
    return back(url, "/contact/?error=check");
  }

  try {
    await env.CONTACT.send({
      from: { name: "getkestrel.dev", email: env.CONTACT_FROM },
      to: env.CONTACT_TO,
      replyTo: name ? { name, email } : email,
      subject: `Message from ${name || email}`,
      text: `From: ${name ? `${name} <${email}>` : email}\n\n${message}\n`,
    });
  } catch (err) {
    console.error(JSON.stringify({ event: "contact.failed", code: err?.code, message: err?.message }));
    return back(url, "/contact/?error=send");
  }
  return back(url, "/contact/sent/");
}

/** Whether Turnstile vouches for the token the widget put in the form. */
async function human(token, request, env) {
  if (!token) {
    return false;
  }
  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  if (ip) {
    body.append("remoteip", ip);
  }
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const outcome = await res.json();
    return outcome.success === true;
  } catch {
    return false;
  }
}

/** A 303 to a page on this site, so a reload never posts the form again. */
function back(url, path) {
  return Response.redirect(new URL(path, url.origin).toString(), 303);
}
