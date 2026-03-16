#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Scan only git-tracked files to match the CI environment exactly.
# This prevents local-only files (.env, .claude/, etc.) from causing false failures.
FILES=()
if [ -d ".git" ]; then
  while IFS= read -r file; do
    # Exclude this script itself from the scan
    [[ "$file" == "scripts/release-audit.sh" ]] && continue
    [[ -f "$file" ]] && FILES+=("./$file")
  done < <(git ls-files)
else
  # Fallback when not in a git repo (e.g. extracted tarball)
  while IFS= read -r file; do
    FILES+=("$file")
  done < <(
    find . -type f \
      -not -path './.git/*' \
      -not -path './.pr-reviews/*' \
      -not -path './node_modules/*' \
      -not -path './dist/*' \
      -not -path './runtime/*' \
      -not -path './coverage/*' \
      -not -path './scripts/release-audit.sh'
  )
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "release-audit: no source files found" >&2
  exit 1
fi

check_no_match() {
  local description="$1"
  local pattern="$2"
  if grep -Pn -e "$pattern" "${FILES[@]}" >/tmp/release-audit-match.txt 2>/dev/null; then
    echo "release-audit: failed: ${description}" >&2
    cat /tmp/release-audit-match.txt >&2
    rm -f /tmp/release-audit-match.txt
    exit 1
  fi
  rm -f /tmp/release-audit-match.txt
}

check_exists() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "release-audit: missing required file: $file" >&2
    exit 1
  fi
}

check_exists "README.md"
check_exists "LICENSE"
check_exists ".gitignore"
check_exists ".env.example"
check_exists "package.json"
check_exists "src/ui/server.ts"
check_exists "src/runtime/usage-cost.ts"

check_no_match "absolute macOS home paths" '/Users/[^/]+/'
check_no_match "absolute Linux home paths" '/home/[^/]+/'
check_no_match "hard-coded internal channel ids" '1477617216529760378'
check_no_match "obvious OpenAI-style secret keys" 'sk-[A-Za-z0-9]{20,}'
check_no_match "hard-coded bearer tokens" 'Authorization: Bearer (?!<)[^[:space:]]+'
check_no_match "hard-coded local API tokens" 'LOCAL_API_TOKEN=(?!<)[^[:space:]]+'
check_no_match "hard-coded x-local-token header values" 'x-local-token:[[:space:]]*(?!<)[^[:space:]]+'

if [ -d ".git" ]; then
  if git ls-files | grep -E '^(runtime|dist|node_modules|coverage|plans|workflows)/' >/tmp/release-audit-match.txt 2>/dev/null; then
    echo "release-audit: failed: ignored build/runtime/internal-only paths are tracked" >&2
    cat /tmp/release-audit-match.txt >&2
    rm -f /tmp/release-audit-match.txt
    exit 1
  fi
  rm -f /tmp/release-audit-match.txt

  if ! git ls-files --error-unmatch src/ui/server.ts >/dev/null 2>&1; then
    echo "release-audit: missing tracked source file: src/ui/server.ts" >&2
    exit 1
  fi

  if ! git ls-files --error-unmatch src/runtime/usage-cost.ts >/dev/null 2>&1; then
    echo "release-audit: missing tracked source file: src/runtime/usage-cost.ts" >&2
    exit 1
  fi
fi

echo "release-audit: passed"
