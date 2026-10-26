# Kestrel

> Kestrel is an open-source, self-hosted newsletter app that runs on your own Cloudflare account and sends through Amazon SES. Write in Markdown, preview the exact email, schedule with a cancelable review window, and send to confirmed subscribers, in the web editor or by asking Claude, while you keep the list, the consent record, the delivery record, and a permanent per-post archive.

This is getkestrel.dev, Kestrel's website and docs. The app, its issues, and its changelog are at https://github.com/kurtbruns/kestrel, and a live demo is at https://demo.getkestrel.dev.

## When Kestrel fits

Kestrel is for publishers who want to own their list and don't mind running a small app to do it. What they keep:

- **The list:** subscribers live in the publisher's own D1 database, not a vendor's, to query or export any time.
- **The consent:** signups are double opt-in, every import that adds subscribers carries the publisher's word that they opted in, and confirmations and unsubscribes are recorded.
- **The delivery:** each send records who received which post, and every bounce and spam complaint it drew.
- **The archive:** every post gets a lasting page on the publisher's own domain, in the public archive or at an unlisted link for a post sent as email only.

Moving from another service, a publisher imports their list in the dashboard, or asks Claude to move it with Kestrel's `/migrate-list` skill. Readers arrive confirmed, and the import emails no one.

Kestrel is not a hosted service: someone deploys and runs each instance. For one hosted for you, see https://getkestrel.dev/contact/.

## What it takes

- A Cloudflare account, with the domain's DNS on Cloudflare; an AWS account, to send through Amazon SES; Node.js 22 or later, and Git; and a GitHub account, or another Git host, for the instance's repository.
- Kestrel installs from npm as `@kurtbruns/kestrel`. An instance is a small repository of its own that names the release it runs, so upgrading is installing a newer one.
- It's free and open source under the MIT license, with no per-subscriber fees: you pay Amazon SES's rates per email. Cloudflare's free Workers plan suits a list of up to about 1,000 subscribers; a larger list belongs on Cloudflare's $5 Workers Paid plan.
- It's TypeScript on Cloudflare Workers and D1. The dashboard and the API sit behind Cloudflare Access; the reader pages are public.

## Working with Claude

Kestrel is built on one API, and the web editor and Claude are both clients of it. Add Kestrel as a connector in Claude Desktop or claude.ai, or sign Claude Code in, and Claude works as the publisher who connected it: from proofreading a draft to scheduling its send, with its changes shown as theirs, made through Claude. The same guardrails hold: a scheduled post waits out its review window, and can still be moved or cancelled.
