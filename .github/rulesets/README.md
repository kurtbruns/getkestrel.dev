# Branch rulesets

`protect-main.json` is a committed copy of the **Protect main** repository ruleset (Settings → Rules → Rulesets). GitHub does **not** apply this file automatically — it lives here for version history, review, and as a re-importable source of truth.

## What it enforces (on the default branch)

- No branch deletion, no force-push, linear history required.
- Changes land via pull request; squash and rebase are the allowed merge methods (both preserve the required linear history — merge commits are not).
- All PR review threads must be resolved before merge.
- The `ci` check (`.github/workflows/ci.yml`) must pass, and the branch must be up to date with `main`, before merge.
- No bypass actors.

The required status check is pinned to context `ci` and the GitHub Actions app (`integration_id: 15368`). If the CI job is renamed, update the context here and re-apply.

## Re-apply / update

```bash
# Create (first time):
gh api --method POST repos/kurtbruns/getkestrel.dev/rulesets --input .github/rulesets/protect-main.json

# Update an existing ruleset (find <id> via: gh api repos/kurtbruns/getkestrel.dev/rulesets):
gh api --method PUT repos/kurtbruns/getkestrel.dev/rulesets/<id> --input .github/rulesets/protect-main.json
```

If you edit the ruleset in the GitHub UI, re-export it here so this file stays the source of truth (drift is not detected automatically).
