/*
 * getkestrel.dev's one dynamic route: the contact form at /contact/ posts here.
 *
 * Everything else on the site is static (Hugo's output, served as Workers Static
 * Assets). wrangler.jsonc's `run_worker_first: ["/api/*"]` sends only /api/ paths
 * to this script, so the pages never pay for it; anything else that reaches it is
 * handed back to the assets.
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
// The form's topics, as the subject line names them. Anything else reads as "other".
const TOPICS = { question: "Question", hosting: "Hosting inquiry", other: "Message" };
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
    return env.ASSETS.fetch(request);
  },
};

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
      subject: `${Object.hasOwn(TOPICS, field("topic")) ? TOPICS[field("topic")] : TOPICS.other} from ${name || email}`,
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
