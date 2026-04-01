#!/usr/bin/env python3
"""
scripts/extract-prompts.py — read-only audit tool.

Extracts agent prompts from shell scripts into eval/prompts-snapshot.md.
Purpose: design-drift review — verify LLM prompts match intended agent behavior.

Usage:
  python3 scripts/extract-prompts.py            # writes eval/prompts-snapshot.md
  python3 scripts/extract-prompts.py --stdout   # print to stdout instead
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


# ── helpers ──────────────────────────────────────────────────────────────────

def find_context_label(lines, target_idx):
    """Walk backwards from target_idx; return nearest function or case label."""
    for i in range(target_idx, -1, -1):
        line = lines[i].strip()
        # bash function definitions
        m = re.match(r'^(cmd_\w+|dispatch_message|process_inbox)\s*\(\)', line)
        if m:
            return m.group(1)
        # case labels like: tc_design)
        m2 = re.match(r'^(\w+)\)$', line)
        if m2:
            return m2.group(1)
    return "unknown"


# ── harness.sh extraction ─────────────────────────────────────────────────────

def extract_from_harness(content: str) -> list[dict]:
    """
    Extract `prompt="..."` multiline blocks.
    Pattern: lines between `  prompt="` and a line that is exactly `"`.
    """
    results = []
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        m = re.match(r'^(\s*)prompt="(.*)', lines[i])
        if m:
            label = find_context_label(lines, i)
            first = m.group(2)
            prompt_lines = [first] if first else []
            start_lineno = i + 2  # 1-based
            i += 1
            while i < len(lines):
                raw = lines[i]
                if raw.strip() == '"':   # closing line
                    break
                prompt_lines.append(raw)
                i += 1
            results.append({
                "source": "scripts/harness.sh",
                "label": label,
                "lineno": start_lineno,
                "text": '\n'.join(prompt_lines),
            })
        i += 1
    return results


# ── huahua-heartbeat.sh extraction ───────────────────────────────────────────

def _collect_until_closing_quote(lines, start_idx):
    """
    Collect prompt lines starting at start_idx until we hit a closing quote.
    Returns (prompt_text, end_idx).

    Closing quote patterns (in raw file text, no newline):
      a) line ends with '"' not preceded by backslash  -> inline prompt end
      b) line ends with '" \'                          -> json-schema prompt end
    """
    prompt_lines = []
    i = start_idx
    while i < len(lines):
        raw = lines[i]
        raw_rstrip = raw.rstrip()

        # Pattern b: `..." \` — json-schema style continuation end
        if re.search(r'[^\\]"\s*\\$', raw_rstrip) or raw_rstrip.endswith('" \\'):
            # Strip the trailing ` \` and closing `"`
            cleaned = re.sub(r'"\s*\\$', '', raw_rstrip)
            if cleaned.strip():
                prompt_lines.append(cleaned)
            return '\n'.join(prompt_lines), i

        # Pattern a: line ends with `"` not preceded by `\`
        # But ignore lines like `${var:-"..."}` which end with `"}`
        if (raw_rstrip.endswith('"')
                and not raw_rstrip.endswith('\\"')
                and not raw_rstrip.endswith('"}')):
            cleaned = raw_rstrip[:-1]  # remove closing "
            if cleaned.strip():
                prompt_lines.append(cleaned)
            return '\n'.join(prompt_lines), i

        prompt_lines.append(raw)
        i += 1

    return '\n'.join(prompt_lines), i


def extract_from_huahua(content: str) -> list[dict]:
    """
    Two patterns:

    Pattern A — direct inline call:
        "${CODEX_CMD[@]}" "Read harness/...
        ...
        last line of content"

    Pattern B — json-schema call (variable OR inline literal schema):
        raw_result=$(..._run_codex_json "$_schema" \\
          "Read harness/...
          last line" \\
        2>&1)
      OR (inline literal schema, e.g. tc_design initial path):
        tc_pr_td=$(_run_codex_json \\
          '{"type":"object",...}' \\
          "Read harness/...
          last line" \\
        2>/dev/null | ...)
    """
    results = []
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        stripped = lines[i].rstrip()

        # Pattern A: helper call with inline prompt
        mA = re.match(r'^\s*[A-Za-z0-9_]+=\$\(_run_codex_json\s+(?:"\$_schema"|\'[^\']*\')\s+"(Read\s+.+)', stripped)
        if mA:
            label = find_context_label(lines, i)
            first_content = mA.group(1)
            start_lineno = i + 1  # 1-based
            # Check if prompt closes on this same line
            if first_content.endswith('"') and not first_content.endswith('\\"'):
                text = first_content[:-1]
            else:
                # Multi-line: first_content is already first line (without closing quote yet)
                # Collect remaining lines
                body, end_i = _collect_until_closing_quote(lines, i + 1)
                text = first_content + ('\n' + body if body else '')
                i = end_i
            results.append({
                "source": "scripts/huahua-heartbeat.sh",
                "label": label,
                "lineno": start_lineno,
                "text": text,
            })
            i += 1
            continue

        # Pattern B: helper invocation spans multiple lines:
        #   raw_result=$(_run_codex_json "$_schema" \
        #     "Read ..."
        # or
        #   tc_pr_td=$(_run_codex_json \
        #     '{"type":"object",...}' \
        #     "Read ..."
        if re.search(r"""_run_codex_json(?:\s+(?:"\$_schema"|'[^']*'))?\s*\\$""", stripped):
            label = find_context_label(lines, i)
            start_lineno = i + 1
            # Skip to the next line that opens the prompt string
            i += 1
            while i < len(lines):
                next_line = lines[i].rstrip()
                mB = re.match(r'^\s+"(Read\s+.*)', next_line)
                if mB:
                    start_lineno = i + 1
                    first_content = mB.group(1)
                    body, end_i = _collect_until_closing_quote(lines, i + 1)
                    text = first_content + ('\n' + body if body else '')
                    i = end_i
                    results.append({
                        "source": "scripts/huahua-heartbeat.sh",
                        "label": label,
                        "lineno": start_lineno,
                        "text": text,
                    })
                    break
                i += 1

        i += 1
    return results


# ── markdown rendering ────────────────────────────────────────────────────────

def render_markdown(all_prompts: list[dict]) -> str:
    lines = [
        "# prompts-snapshot.md",
        "",
        "> Auto-generated by `scripts/extract-prompts.py`.",
        "> Read-only audit tool — prompts stay inline in source scripts.",
        "> Use this file to check for design drift: do prompts match intended agent behaviour?",
        "",
        f"Total prompts extracted: **{len(all_prompts)}**",
        "",
        "---",
        "",
    ]
    for p in all_prompts:
        fn_label = p['label']
        lines += [
            f"## {p['source'].split('/')[1]} · {fn_label}",
            "",
            f"**Source:** `{p['source']}` (around line {p['lineno']})",
            "",
            "```",
            p['text'].rstrip(),
            "```",
            "",
            "---",
            "",
        ]
    return '\n'.join(lines)


# ── main ──────────────────────────────────────────────────────────────────────

SOURCES = [
    ("scripts/harness.sh", "harness"),
    ("scripts/huahua-heartbeat.sh", "huahua"),
]


def main():
    to_stdout = "--stdout" in sys.argv
    all_prompts = []

    for rel_path, kind in SOURCES:
        fpath = REPO_ROOT / rel_path
        if not fpath.exists():
            print(f"WARNING: {rel_path} not found", file=sys.stderr)
            continue
        content = fpath.read_text(encoding="utf-8")
        if kind == "harness":
            extracted = extract_from_harness(content)
        else:
            extracted = extract_from_huahua(content)
        print(f"  {rel_path}: {len(extracted)} prompt(s) found", file=sys.stderr)
        all_prompts.extend(extracted)

    md = render_markdown(all_prompts)

    if to_stdout:
        print(md)
    else:
        out = REPO_ROOT / "eval" / "prompts-snapshot.md"
        out.parent.mkdir(exist_ok=True)
        out.write_text(md, encoding="utf-8")
        print(f"Written: {out} ({len(all_prompts)} prompts total)", file=sys.stderr)


if __name__ == "__main__":
    main()
