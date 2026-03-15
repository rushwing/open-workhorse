#!/usr/bin/env bash
# harness.sh — Harness Engineering Agent 任务触发器（open-workhorse 简化版）
#
# 用法:
#   ./scripts/harness.sh status              # 列出当前可认领任务
#   ./scripts/harness.sh implement <REQ-N>   # Claude Code 认领并实现需求
#   ./scripts/harness.sh bugfix <BUG-N>      # Claude Code 认领并修复 Bug
#   ./scripts/harness.sh fix-review <PR#>    # Claude Code 修复 PR review comments

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# harness.sh 主动触发时默认跳过逐步权限确认
CLAUDE_CMD=(claude --dangerously-skip-permissions -p)
if [[ -n "${CLAUDE_APPROVAL+x}" && -z "${CLAUDE_APPROVAL}" ]]; then
  CLAUDE_CMD=(claude -p)
elif [[ -n "${CLAUDE_APPROVAL:-}" ]]; then
  CLAUDE_CMD=(claude "$CLAUDE_APPROVAL" -p)
fi

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[harness]${NC} $*"; }
ok()    { echo -e "${GREEN}[harness]${NC} $*"; }
warn()  { echo -e "${YELLOW}[harness]${NC} $*"; }
err()   { echo -e "${RED}[harness]${NC} $*" >&2; }

# ── Session 日志 ──────────────────────────────────────────────────────────────
SESSION_LOG=".harness_sessions"
log_session() {
  local cmd="$1" target="${2:-}"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $cmd${target:+ $target}" >> "$SESSION_LOG"
}

# ── 工具函数 ──────────────────────────────────────────────────────────────────

# 从 frontmatter 中提取字段值
get_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# 列出可认领的 REQ 任务
list_claimable_reqs() {
  local count=0
  if [[ ! -d "tasks/features" ]]; then return; fi

  for f in tasks/features/REQ-*.md; do
    [[ -f "$f" ]] || continue
    local status owner tc_policy
    status="$(get_field "$f" "status")"
    owner="$(get_field "$f" "owner")"
    tc_policy="$(get_field "$f" "tc_policy")"

    # Claimable: test_designed + unassigned，或 (ready + optional/exempt) + unassigned
    local claimable=false
    if [[ "$status" == "test_designed" && "$owner" == "unassigned" ]]; then
      claimable=true
    elif [[ "$status" == "ready" && "$owner" == "unassigned" ]]; then
      if [[ "$tc_policy" == "optional" || "$tc_policy" == "exempt" ]]; then
        claimable=true
      fi
    fi

    if $claimable; then
      local req_id priority
      req_id="$(get_field "$f" "req_id")"
      priority="$(get_field "$f" "priority")"
      echo "  ${GREEN}REQ${NC}  $req_id  [${priority}]  status=${status}  ${f}"
      (( count++ )) || true
    fi
  done
  echo "$count"
}

# 列出可认领的 BUG 任务
list_claimable_bugs() {
  local count=0
  if [[ ! -d "tasks/bugs" ]]; then return; fi

  for f in tasks/bugs/BUG-*.md; do
    [[ -f "$f" ]] || continue
    local status owner
    status="$(get_field "$f" "status")"
    owner="$(get_field "$f" "owner")"

    if [[ "$status" == "confirmed" && "$owner" == "unassigned" ]]; then
      local bug_id priority
      bug_id="$(get_field "$f" "bug_id")"
      priority="$(get_field "$f" "priority")"
      echo "  ${RED}BUG${NC}  $bug_id  [${priority}]  ${f}"
      (( count++ )) || true
    fi
  done
  echo "$count"
}

# ── 子命令 ────────────────────────────────────────────────────────────────────

cmd_status() {
  info "扫描可认领任务..."
  echo ""

  local req_output bug_output req_count bug_count
  req_output="$(list_claimable_reqs)"
  bug_output="$(list_claimable_bugs)"

  req_count="$(echo "$req_output" | tail -1)"
  bug_count="$(echo "$bug_output" | tail -1)"

  local req_lines bug_lines
  req_lines="$(echo "$req_output" | awk 'NR>1{print prev} {prev=$0}')"
  bug_lines="$(echo "$bug_output" | awk 'NR>1{print prev} {prev=$0}')"

  if [[ -n "$req_lines" ]]; then
    echo -e "可认领需求项（REQ）："
    echo -e "$req_lines"
    echo ""
  fi

  if [[ -n "$bug_lines" ]]; then
    echo -e "可认领 Bug（BUG）："
    echo -e "$bug_lines"
    echo ""
  fi

  local total=$(( req_count + bug_count ))
  if [[ $total -eq 0 ]]; then
    ok "no claimable tasks — tasks/ 中无待认领项目"
  else
    ok "共 ${total} 个可认领任务（REQ: ${req_count}，BUG: ${bug_count}）"
    echo ""
    info "提示：使用 ./scripts/harness.sh implement <REQ-N> 或 bugfix <BUG-N> 触发实现"
  fi
}

cmd_implement() {
  local req_id="${1:-}"
  if [[ -z "$req_id" ]]; then
    err "用法：./scripts/harness.sh implement <REQ-N>"
    exit 1
  fi

  local req_file="tasks/features/${req_id}.md"
  if [[ ! -f "$req_file" ]]; then
    err "未找到需求文件：${req_file}"
    exit 1
  fi

  local status owner tc_policy
  status="$(get_field "$req_file" "status")"
  owner="$(get_field "$req_file" "owner")"
  tc_policy="$(get_field "$req_file" "tc_policy")"

  # 检查是否可认领
  local claimable=false
  if [[ "$status" == "test_designed" && "$owner" == "unassigned" ]]; then
    claimable=true
  elif [[ "$status" == "ready" && "$owner" == "unassigned" ]]; then
    if [[ "$tc_policy" == "optional" || "$tc_policy" == "exempt" ]]; then
      claimable=true
    fi
  fi

  if ! $claimable && [[ "${FORCE:-}" != "true" ]]; then
    warn "${req_id} 当前状态为 status=${status}, owner=${owner}，不满足认领条件"
    warn "如需强制执行，设置 FORCE=true 或使用 --force 参数"
    exit 1
  fi

  info "触发 Claude Code 实现 ${req_id}..."
  log_session "implement" "$req_id"

  local prompt
  prompt="Read CLAUDE.md and harness/harness-index.md.
Your task: implement ${req_id}.

Steps:
1. Read ${req_file} and all test_case_ref TC files before writing any code
2. Read the current Phase doc in tasks/phases/ to confirm iteration boundary
3. Claim: in your working branch, update ${req_file}: owner=claude_code, status=in_progress, commit 'claim: ${req_id}'
4. Write tests first (or confirm TC is runnable), then implement
5. Before opening PR: npm run release:audit && npm run build && npm test
6. Update ${req_file}: status=review, fill Agent Notes with implementation notes
7. Open PR with title matching 'feat: ${req_id} ...' or 'fix: ${req_id} ...'
"

  "${CLAUDE_CMD[@]}" "$prompt"
}

cmd_bugfix() {
  local bug_id="${1:-}"
  if [[ -z "$bug_id" ]]; then
    err "用法：./scripts/harness.sh bugfix <BUG-N>"
    exit 1
  fi

  local bug_file="tasks/bugs/${bug_id}.md"
  if [[ ! -f "$bug_file" ]]; then
    err "未找到 Bug 文件：${bug_file}"
    exit 1
  fi

  info "触发 Claude Code 修复 ${bug_id}..."
  log_session "bugfix" "$bug_id"

  local prompt
  prompt="Read harness/bug-standard.md.
Your task: fix ${bug_id}.

Steps:
1. Create branch: fix/${bug_id}-<short-desc>
2. First commit: update ${bug_file} only — owner=claude_code, status=in_progress, commit 'claim: ${bug_id}'
3. Read ${bug_file} fully — reproduction steps, related_req, related_tc
4. Fix the bug + add regression test (node:test)
5. Final commit: set status=fixed, fill 根因分析 and 修复方案 in ${bug_file}
6. npm run release:audit && npm run build && npm test must pass
7. Open PR
"

  "${CLAUDE_CMD[@]}" "$prompt"
}

cmd_fix_review() {
  local pr_num="${1:-}"
  if [[ -z "$pr_num" ]]; then
    err "用法：./scripts/harness.sh fix-review <PR号>"
    exit 1
  fi

  info "获取 PR #${pr_num} 的 review comments..."

  # 获取 review 顶层 comment
  local top_comments inline_comments
  top_comments="$(gh pr view "$pr_num" --json reviews --jq '.reviews[] | "### Review by \(.author.login) [\(.state)]\n\(.body)"' 2>/dev/null || echo "(无法获取 review，请确认 gh 已认证)")"
  inline_comments="$(gh api "repos/{owner}/{repo}/pulls/${pr_num}/comments" --jq '.[] | "File: \(.path) line \(.line // .original_line)\nComment: \(.body)\nID: \(.id)"' 2>/dev/null || echo "(无法获取 inline comments)")"

  log_session "fix-review" "#$pr_num"

  local prompt
  prompt="Read harness/review-standard.md.

## Pre-fetched context for PR #${pr_num}

### Top-level review summaries
${top_comments}

### Inline review comments
${inline_comments}

## Your task
Address every finding in both sections:
1. Read the referenced file+line for each inline comment
2. Fix the code or doc (do NOT skip any finding)
3. If a finding is invalid, note why — do not silently ignore
4. After all fixes are pushed:
   a) Inline comments (have ID above) → reply via:
      gh api repos/{owner}/{repo}/pulls/${pr_num}/comments/<id>/replies -X POST -f body='Fixed in <sha>: <summary>'
   b) Top-level review summaries → one general comment:
      gh pr review ${pr_num} --comment -b 'Addressed review findings: ...'
Do NOT merge the PR — HITL merge only.
"

  "${CLAUDE_CMD[@]}" "$prompt"
}

# ── 入口 ──────────────────────────────────────────────────────────────────────
COMMAND="${1:-}"

case "$COMMAND" in
  status)
    cmd_status
    ;;
  implement)
    shift
    # --force 支持
    if [[ "${1:-}" == "--force" ]]; then
      export FORCE=true
      shift
    fi
    cmd_implement "${1:-}"
    ;;
  bugfix)
    shift
    cmd_bugfix "${1:-}"
    ;;
  fix-review)
    shift
    cmd_fix_review "${1:-}"
    ;;
  "")
    echo "用法：./scripts/harness.sh <命令> [参数]"
    echo ""
    echo "命令："
    echo "  status              列出当前可认领任务"
    echo "  implement <REQ-N>   Claude Code 认领并实现需求"
    echo "  bugfix <BUG-N>      Claude Code 认领并修复 Bug"
    echo "  fix-review <PR#>    Claude Code 修复 PR review comments"
    echo ""
    echo "环境变量："
    echo "  CLAUDE_APPROVAL     覆盖 claude 默认的 --dangerously-skip-permissions"
    echo "  FORCE=true          跳过认领前提检查（implement 子命令）"
    exit 0
    ;;
  *)
    err "未知命令：${COMMAND}"
    echo "运行 ./scripts/harness.sh 查看帮助"
    exit 1
    ;;
esac
