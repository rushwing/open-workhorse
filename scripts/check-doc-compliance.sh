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
    '*.html' \
    ':!:README.md' \
    ':!:CLAUDE.md'
)

if [ "${#DOC_FILES[@]}" -eq 0 ]; then
  echo "doc-compliance: no tracked documentation files found" >&2
  exit 1
fi

check_no_match() {
  local description="$1"
  local pattern="$2"
  if grep -Pn -e "$pattern" "${DOC_FILES[@]}" >/tmp/doc-compliance-match.txt 2>/dev/null; then
    echo "doc-compliance: failed: ${description}" >&2
    cat /tmp/doc-compliance-match.txt >&2
    rm -f /tmp/doc-compliance-match.txt
    exit 1
  fi
  rm -f /tmp/doc-compliance-match.txt
}

check_no_match "disallowed product-reference wording" 'fake-claude-code'
check_no_match "disallowed copycat wording" '\bcopycat\b'
check_no_match "disallowed clone wording" '\bnear-clone\b|\bclone another product\b'

echo "doc-compliance: passed"
