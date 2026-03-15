#!/usr/bin/env bash
# harness.sh — Harness Engineering Agent 任务触发器（open-workhorse 简化版）
#
# 用法:
#   ./scripts/harness.sh status              # 列出当前可认领任务
#   ./scripts/harness.sh implement <REQ-N>   # Claude Code 认领并实现需求
#   ./scripts/harness.sh bugfix <BUG-N>      # Claude Code 认领并修复 Bug
#   ./scripts/harness.sh fix-review <PR#>    # Claude Code 修复 PR review comments
#   ./scripts/harness.sh tc-review <PR#>     # Menglan 评审 TC PR（adequate/missing-branch/redundant）

set -euo pipefail

# 抑制交互式提示：gh CLI、npm 等工具在 CI=true 时自动非交互
export CI=true
export GH_NO_UPDATE_NOTIFIER=1

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# 解析当前仓库的 owner/repo（供 gh api 调用使用）
GH_REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"

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

# 检查 depends_on 中所有项是否已 done
# 返回值：0=全部完成（或无依赖），1=有未完成项
# 副作用：打印阻塞项 warn 信息（stderr，不污染 $() 捕获）
check_depends_done() {
  local file="$1"
  local depends_raw
  depends_raw="$(awk -F': ' '/^depends_on:/{for(i=2;i<=NF;i++) printf $i; print ""}' "$file" | tr -d '[]')"
  [[ -z "$(echo "$depends_raw" | tr -d ' ')" ]] && return 0

  local any_blocked=false
  IFS=',' read -ra deps <<< "$depends_raw"
  for dep in "${deps[@]}"; do
    dep="$(echo "$dep" | tr -d ' ')"
    [[ -z "$dep" ]] && continue
    local dep_status=""
    for search_path in \
      "tasks/features/${dep}.md" \
      "tasks/bugs/${dep}.md" \
      "tasks/archive/done/${dep}.md"; do
      if [[ -f "$search_path" ]]; then
        dep_status="$(get_field "$search_path" "status")"
        break
      fi
    done
    if [[ -z "$dep_status" ]]; then
      warn "depends_on '${dep}' 未找到对应文件" >&2
      any_blocked=true
    elif [[ "$dep_status" != "done" ]]; then
      warn "depends_on '${dep}' 尚未完成（status=${dep_status}）" >&2
      any_blocked=true
    fi
  done
  $any_blocked && return 1 || return 0
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
      # depends_on 全部 done 才真正可认领
      if ! check_depends_done "$f" 2>/dev/null; then
        claimable=false
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
      # depends_on 全部 done 才真正可认领
      if check_depends_done "$f" 2>/dev/null; then
        local bug_id priority
        bug_id="$(get_field "$f" "bug_id")"
        priority="$(get_field "$f" "priority")"
        echo "  ${RED}BUG${NC}  $bug_id  [${priority}]  ${f}"
        (( count++ )) || true
      fi
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

  # depends_on 检查（FORCE 可绕过）
  if [[ "${FORCE:-}" != "true" ]]; then
    if ! check_depends_done "$req_file"; then
      err "${req_id} depends_on 中存在未完成项，无法认领（见上方 warn）"
      warn "如需强制执行，设置 FORCE=true 或使用 --force 参数"
      exit 1
    fi
  fi

  info "触发 Claude Code 实现 ${req_id}..."
  log_session "implement" "$req_id"

  local prompt
  prompt="Read CLAUDE.md and harness/harness-index.md.
Your task: implement ${req_id}.
Do not ask clarifying questions — proceed with your best judgment at every step.

Steps:
1. Read ${req_file} and all test_case_ref TC files before writing any code
2. Read the current Phase doc in tasks/phases/ to confirm iteration boundary
3. Claim: in your working branch, update ${req_file}: owner=claude_code, status=in_progress, commit 'claim: ${req_id}'
4. Write tests first (or confirm TC is runnable), then implement
5. Before opening PR: npm run release:audit && npm run build && npm test
6. Update ${req_file}: status=review, fill Agent Notes with implementation notes
7. Open PR using: gh pr create --fill
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

  # 认领前提检查（requirement: status=confirmed, owner=unassigned, depends_on done）
  if [[ "${FORCE:-}" != "true" ]]; then
    local b_status b_owner
    b_status="$(get_field "$bug_file" "status")"
    b_owner="$(get_field "$bug_file" "owner")"

    if [[ "$b_status" != "confirmed" ]]; then
      err "${bug_id} status=${b_status}，期望 status=confirmed（见 bug-standard.md §6.1）"
      warn "如需强制执行，设置 FORCE=true 或使用 --force 参数"
      exit 1
    fi
    if [[ "$b_owner" != "unassigned" ]]; then
      err "${bug_id} owner=${b_owner}，期望 owner=unassigned（已被认领）"
      warn "如需强制执行，设置 FORCE=true 或使用 --force 参数"
      exit 1
    fi
    if ! check_depends_done "$bug_file"; then
      err "${bug_id} depends_on 中存在未完成项，无法认领（见上方 warn）"
      warn "如需强制执行，设置 FORCE=true 或使用 --force 参数"
      exit 1
    fi
  fi

  info "触发 Claude Code 修复 ${bug_id}..."
  log_session "bugfix" "$bug_id"

  local prompt
  prompt="Read harness/bug-standard.md.
Your task: fix ${bug_id}.
Do not ask clarifying questions — proceed with your best judgment at every step.

Steps:
1. Create branch: fix/${bug_id}-<short-desc>
2. First commit: update ${bug_file} only — owner=claude_code, status=in_progress, commit 'claim: ${bug_id}'
3. Read ${bug_file} fully — reproduction steps, related_req, related_tc
4. Fix the bug + add regression test (node:test)
5. Final commit: set status=fixed, fill 根因分析 and 修复方案 in ${bug_file}
6. npm run release:audit && npm run build && npm test must pass
7. Open PR using: gh pr create --fill
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
  if [[ -z "$GH_REPO" ]]; then
    err "无法解析仓库 owner/repo，请确认 gh 已认证且当前目录是 GitHub 仓库"
    exit 1
  fi
  inline_comments="$(gh api "repos/${GH_REPO}/pulls/${pr_num}/comments" --jq '.[] | "File: \(.path) line \(.line // .original_line)\nComment: \(.body)\nID: \(.id)"' 2>/dev/null || echo "(无法获取 inline comments)")"

  log_session "fix-review" "#$pr_num"

  local prompt
  prompt="Read harness/review-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

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
      gh api repos/${GH_REPO}/pulls/${pr_num}/comments/<id>/replies -X POST -f body='Fixed in <sha>: <summary>'
   b) Top-level review summaries → one general comment:
      gh pr review ${pr_num} --comment -b 'Addressed review findings: ...'
Do NOT merge the PR — HITL merge only.
"

  "${CLAUDE_CMD[@]}" "$prompt"
}

cmd_tc_review() {
  local pr_num="${1:-}"
  if [[ -z "$pr_num" ]]; then
    err "用法：./scripts/harness.sh tc-review <PR号>"
    exit 1
  fi

  info "获取 TC PR #${pr_num} 的 review comments..."

  local top_comments inline_comments
  top_comments="$(gh pr view "$pr_num" --json reviews --jq '.reviews[] | "### Review by \(.author.login) [\(.state)]\n\(.body)"' 2>/dev/null || echo "(无法获取 review，请确认 gh 已认证)")"
  if [[ -z "$GH_REPO" ]]; then
    err "无法解析仓库 owner/repo，请确认 gh 已认证且当前目录是 GitHub 仓库"
    exit 1
  fi
  inline_comments="$(gh api "repos/${GH_REPO}/pulls/${pr_num}/comments" --jq '.[] | "File: \(.path) line \(.line // .original_line)\nComment: \(.body)\nID: \(.id)"' 2>/dev/null || echo "(无法获取 inline comments)")"

  # 从三个来源依次提取 REQ id，优先级：branch name > PR title > changed files
  local pr_info req_hint=""
  pr_info="$(gh pr view "$pr_num" --json title,headRefName 2>/dev/null || echo '{}')"
  # 1. branch name（如 tc/REQ-021-slug 或 feat/REQ-021-...）
  req_hint="$(echo "$pr_info" | grep -o '"headRefName":"[^"]*"' | cut -d'"' -f4 \
              | grep -oE 'REQ-[0-9]+' | head -1 || true)"
  # 2. PR title
  if [[ -z "$req_hint" ]]; then
    req_hint="$(echo "$pr_info" | grep -o '"title":"[^"]*"' | cut -d'"' -f4 \
                | grep -oE 'REQ-[0-9]+' | head -1 || true)"
  fi
  # 3. changed files（tasks/features/REQ-*.md が含まれていれば）
  if [[ -z "$req_hint" ]]; then
    req_hint="$(gh pr view "$pr_num" --json files --jq '.files[].path' 2>/dev/null \
                | grep -oE 'REQ-[0-9]+' | head -1 || true)"
  fi

  # 加载 REQ 文件内容（acceptance criteria + test case design notes）供 prompt 引用
  local req_contract=""
  if [[ -n "$req_hint" ]]; then
    local req_file="tasks/features/${req_hint}.md"
    if [[ -f "$req_file" ]]; then
      req_contract="$(cat "$req_file")"
    else
      warn "REQ 文件 ${req_file} 未找到，TC review 将缺少 acceptance criteria 上下文" >&2
    fi
  else
    warn "无法从 PR #${pr_num} 标题中提取 REQ id，TC review 将缺少 acceptance criteria 上下文" >&2
  fi

  log_session "tc-review" "#$pr_num"

  local prompt
  prompt="Read harness/testing-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

## Pre-fetched context for TC PR #${pr_num}${req_hint:+ (${req_hint})}

### REQ contract (acceptance criteria + test case design notes)
${req_contract:-"(REQ file not found — judge TCs against PR description only)"}

### Top-level review summaries
${top_comments}

### Inline review comments
${inline_comments}

## Your task
Review TC coverage in PR #${pr_num}${req_hint:+ for ${req_hint}} against the REQ contract above.
Each acceptance criterion must be traceable to at least one TC.

For each TC, label it exactly one of:
- **adequate** — covers the stated acceptance criterion
- **missing-branch** — acceptance criterion exists but no TC covers it
- **redundant** — duplicates another TC without adding coverage value

Rules:
1. Report findings only — do NOT modify any TC files
2. Do not ask clarifying questions
3. After labelling all TCs, conclude with exactly one of:
   - \`tc-review: APPROVED\` (all TCs adequate, no missing branches)
   - \`tc-review: NEEDS_CHANGES\` (one or more missing-branch or other issues found)
"

  "${CLAUDE_CMD[@]}" "$prompt"
}

cmd_runbook() {
  local keyword="${1:-}"
  local runbook_dir="$REPO_ROOT/harness/runbook"

  if [[ ! -d "$runbook_dir" ]]; then
    warn "harness/runbook/ 目录不存在"
    return 0
  fi

  local entries=()
  for f in "$runbook_dir"/RB-*.md; do
    [[ -f "$f" ]] || continue
    entries+=("$f")
  done

  if [[ ${#entries[@]} -eq 0 ]]; then
    info "harness/runbook/ 中暂无条目"
    return 0
  fi

  if [[ -n "$keyword" ]]; then
    info "搜索 runbook（关键词：${keyword}）..."
    echo ""
    local found=0
    for f in "${entries[@]}"; do
      if grep -qi "$keyword" "$f"; then
        local rb_id title trigger
        rb_id="$(awk -F': ' '/^runbook_id:/{print $2}' "$f" | tr -d ' ')"
        title="$(awk -F': ' '/^title:/{print $2}' "$f")"
        trigger="$(awk -F': ' '/^trigger_command:/{print $2}' "$f")"
        echo -e "  ${CYAN}${rb_id}${NC}  ${title}"
        [[ -n "$trigger" ]] && echo -e "           trigger: ${trigger}"
        echo ""
        found=$(( found + 1 ))
      fi
    done
    if [[ $found -eq 0 ]]; then
      info "未找到匹配「${keyword}」的 runbook 条目"
    else
      ok "共 ${found} 条匹配"
    fi
  else
    info "所有 runbook 条目："
    echo ""
    for f in "${entries[@]}"; do
      local rb_id title trigger
      rb_id="$(awk -F': ' '/^runbook_id:/{print $2}' "$f" | tr -d ' ')"
      title="$(awk -F': ' '/^title:/{print $2}' "$f")"
      trigger="$(awk -F': ' '/^trigger_command:/{print $2}' "$f")"
      echo -e "  ${CYAN}${rb_id}${NC}  ${title}"
      [[ -n "$trigger" ]] && echo -e "           trigger: ${trigger}"
      echo -e "           文件：${f}"
      echo ""
    done
  fi
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
  tc-review)
    shift
    cmd_tc_review "${1:-}"
    ;;
  runbook)
    shift
    cmd_runbook "${1:-}"
    ;;
  "")
    echo "用法：./scripts/harness.sh <命令> [参数]"
    echo ""
    echo "命令："
    echo "  status              列出当前可认领任务"
    echo "  implement <REQ-N>   Claude Code 认领并实现需求"
    echo "  bugfix <BUG-N>      Claude Code 认领并修复 Bug"
    echo "  fix-review <PR#>    Claude Code 修复 PR review comments"
    echo "  tc-review <PR#>     Menglan 评审 TC PR（adequate/missing-branch/redundant）"
    echo "  runbook [keyword]   列出 / 搜索 harness/runbook/ 条目"
    echo ""
    echo "环境变量："
    echo "  CLAUDE_APPROVAL     覆盖 claude 默认的 --dangerously-skip-permissions"
    echo "  FORCE=true          跳过认领前提检查（implement 子命令）"
    echo "  DRY_RUN=true        dev-cycle-watchdog 专用：仅打印不发 Telegram"
    exit 0
    ;;
  *)
    err "未知命令：${COMMAND}"
    echo "运行 ./scripts/harness.sh 查看帮助"
    exit 1
    ;;
esac
