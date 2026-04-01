#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DOC_FILES=()
while IFS= read -r file; do
  [[ -f "$file" ]] && DOC_FILES+=("$file")
done < <(
  git ls-files \
    'docs/**' \
    '*.md' \
    '*.mdx' \
    '*.svg' \
    '*.html'
)

if [ "${#DOC_FILES[@]}" -eq 0 ]; then
  echo "doc-compliance: no tracked documentation files found" >&2
  exit 1
fi

TMPFILE="$(mktemp)"
trap 'rm -f "$TMPFILE"' EXIT

check_no_match() {
  local description="$1"
  local pattern="$2"
  if grep -Ein -e "$pattern" "${DOC_FILES[@]}" >"$TMPFILE"; then
    echo "doc-compliance: failed: ${description}" >&2
    cat "$TMPFILE" >&2
    exit 1
  else
    local status=$?
    if [ "$status" -eq 1 ]; then
      return 0
    fi
    echo "doc-compliance: error: grep failed while checking ${description}" >&2
    exit "$status"
  fi
}

check_no_match "disallowed product-reference wording" 'fake-claude-code'
check_no_match "disallowed copycat wording" '(^|[^[:alnum:]_])copycat([^[:alnum:]_]|$)'
check_no_match "disallowed clone wording" '(^|[^[:alnum:]_])near-clone([^[:alnum:]_]|$)|clone another product'

echo "doc-compliance: passed"
