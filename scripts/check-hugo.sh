#!/usr/bin/env bash
# Verify the pinned Hugo version is consistent across the two sync points:
# .tool-versions and hugo.toml [module.hugoVersion] min. Also verify the
# installed Hugo binary on PATH matches, and that the GitHub Actions
# workflows haven't drifted back to a hardcoded `hugo-version:` literal
# (they should read `.tool-versions` via a shell step).
#
# Usage:
#   scripts/check-hugo.sh           # full diagnostic table to stdout; exit 0 / 1
#   scripts/check-hugo.sh --quiet   # silent on success; one error line per
#                                   # issue to stderr on failure (Claude Code's
#                                   # SessionStart hook UI surfaces only the
#                                   # first line of stderr, so we keep each
#                                   # line self-contained and put the most
#                                   # severe error first).

set -uo pipefail

quiet=0
if [ "${1:-}" = "--quiet" ]; then
  quiet=1
fi

# In --quiet mode (hook context), diagnostic goes to stderr so Claude Code
# surfaces it under the SessionStart warning chevron. In normal mode
# (npm run hugo:check), it goes to stdout for the dev's terminal.
out() {
  if [ "$quiet" = "1" ]; then
    printf '%s\n' "$*" >&2
  else
    printf '%s\n' "$*"
  fi
}

out_kv() {
  if [ "$quiet" = "1" ]; then
    printf "%-32s %s\n" "$1" "$2" >&2
  else
    printf "%-32s %s\n" "$1" "$2"
  fi
}

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

tool_versions_pin="$(grep -E '^hugo extended_' .tool-versions 2>/dev/null | sed 's/^hugo extended_//' | tr -d '[:space:]')"
config_pin="$(grep -oE 'min[[:space:]]*=[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"' hugo.toml 2>/dev/null | head -1 | sed -E 's/.*"([0-9.]+)".*/\1/')"

binary_line="$(hugo version 2>/dev/null || true)"
binary_version="$(echo "$binary_line" | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1 | sed 's/^v//')"
binary_vendor="$(echo "$binary_line" | grep -oE 'VendorInfo=[a-zA-Z]+' | sed 's/VendorInfo=//')"

# Detect whether asdf is set up. If so, "binary missing" usually means the
# pinned version isn't installed yet (post-pull scenario) rather than the
# whole asdf setup being absent.
asdf_available=0
if command -v asdf >/dev/null 2>&1; then
  asdf_available=1
fi

# Determine status before printing anything (so --quiet can short-circuit on success).
status=0
errors=()
warnings=()

if [ -z "$tool_versions_pin" ] || [ -z "$config_pin" ]; then
  errors+=("Could not read Hugo pin from .tool-versions and/or hugo.toml [module.hugoVersion] min.")
  status=1
elif [ "$tool_versions_pin" != "$config_pin" ]; then
  errors+=("Pin files disagree: .tool-versions=$tool_versions_pin, hugo.toml min=$config_pin. Align both before building.")
  status=1
fi

if [ -z "$binary_version" ]; then
  if [ "$asdf_available" = "1" ] && [ -n "$tool_versions_pin" ]; then
    errors+=("Hugo $tool_versions_pin pinned but not installed. Run: asdf install")
  else
    errors+=("Hugo binary not on PATH. See README for install instructions.")
  fi
  status=1
elif [ -n "$tool_versions_pin" ] && [ "$binary_version" != "$tool_versions_pin" ]; then
  if [ "$asdf_available" = "1" ]; then
    errors+=("Installed Hugo $binary_version doesn't match pin $tool_versions_pin. Run: asdf install")
  else
    errors+=("Installed Hugo $binary_version doesn't match pin $tool_versions_pin. Run \`brew upgrade hugo\` or switch to asdf (see README).")
  fi
  status=1
fi

if [ -n "$binary_vendor" ] && [ "$binary_vendor" != "gohugoio" ]; then
  warnings+=("VendorInfo=$binary_vendor (expected gohugoio). You may be running Homebrew Hugo.")
fi

# Verify the GHA workflows still read .tool-versions and haven't drifted
# back to a hardcoded version literal. A hardcoded `hugo-version: '0.X.Y'`
# in a workflow means CI/deploy will silently disagree with .tool-versions
# on the next bump.
for wf in .github/workflows/ci.yml .github/workflows/deploy.yml; do
  if [ -f "$wf" ]; then
    if grep -qE "hugo-version:[[:space:]]*['\"]?[0-9]" "$wf"; then
      errors+=("$wf has a hardcoded hugo-version literal. It should read from .tool-versions via a shell step.")
      status=1
    fi
  fi
done

# Output
if [ "$quiet" = "1" ]; then
  # Hook context: emit one line per issue to stderr. Skip the table — each
  # error message is already self-contained, and Claude Code only surfaces
  # the first line of stderr on non-zero exit anyway.
  if [ "$status" = "0" ] && [ "${#warnings[@]}" = "0" ]; then
    exit 0
  fi
  for msg in "${errors[@]}"; do
    printf '%s\n' "✗ $msg" >&2
  done
  for msg in "${warnings[@]}"; do
    printf '%s\n' "⚠ $msg" >&2
  done
  exit "$status"
fi

# Terminal context: full diagnostic table + status to stdout.
out_kv "Pinned (.tool-versions):" "${tool_versions_pin:-?}"
out_kv "Pinned (hugo.toml min):"  "${config_pin:-?}"
out_kv "Installed binary:"        "${binary_version:-NOT FOUND} (VendorInfo=${binary_vendor:-?})"
out ""

for msg in "${errors[@]}"; do
  out "✗ $msg"
done
for msg in "${warnings[@]}"; do
  out "⚠ $msg"
done

if [ "$status" = "0" ] && [ "${#warnings[@]}" = "0" ]; then
  out "✓ Hugo $binary_version pinned and installed consistently."
fi

exit "$status"
