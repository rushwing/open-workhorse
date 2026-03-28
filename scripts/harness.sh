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

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_ROOT"

# source .env（如存在），使 AGENT_* 等变量可用
# shellcheck source=/dev/null
[[ -f ".env" ]] && source ".env"

# Agent 名称回退默认值（.env 未设置时生效）
AGENT_ORCHESTRATOR="${AGENT_ORCHESTRATOR:-pandas}"
AGENT_CODER="${AGENT_CODER:-menglan}"
AGENT_REVIEWER="${AGENT_REVIEWER:-huahua}"

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

# ── Worktree 管理 ─────────────────────────────────────────────────────────────

# Menglan worktree 路径（可通过 .env 中的 MENGLAN_WORKTREE_ROOT 覆盖）
MENGLAN_WORKTREE_ROOT="${MENGLAN_WORKTREE_ROOT:-$HOME/workspace-menglan/open-workhorse}"

# 为指定 REQ 创建 git worktree（幂等：路径+分支双重校验）
cmd_worktree_setup() {
  local req_id="$1"
  local branch="feat/${req_id}"
  local worktree_path="$MENGLAN_WORKTREE_ROOT"

  if git worktree list | grep -qF "$worktree_path"; then
    # 已存在——检查是否绑定到正确分支
    local current_branch
    current_branch="$(git -C "$worktree_path" branch --show-current 2>/dev/null || true)"
    if [[ "$current_branch" == "$branch" ]]; then
      info "worktree 已存在且分支正确：${worktree_path} → ${branch} — 同步远端最新提交"
      # Always pull Huahua's latest TC commits before Menglan resumes work
      git fetch origin "${branch}" 2>/dev/null \
        && git -C "$worktree_path" merge --ff-only "origin/${branch}" 2>/dev/null \
        && info "远端同步完成：${branch}" \
        || warn "远端同步失败（离线或分支未推送），继续使用本地状态"
      return 0
    else
      err "worktree 路径 ${worktree_path} 已被 ${current_branch:-unknown} 占用，期望 ${branch}"
      err "请先执行：./scripts/harness.sh worktree-clean <上一个 REQ-N>"
      exit 1
    fi
  fi

  # 分支不存在则创建：优先从远端拉取（Huahua 已建 TC PR 时），否则基于 main 新建
  if ! git show-ref --verify --quiet "refs/heads/${branch}"; then
    local ls_rc=0
    git ls-remote --exit-code origin "refs/heads/${branch}" &>/dev/null || ls_rc=$?
    # --exit-code semantics: 0=found, 2=absent, anything else=error (network/auth)
    if [[ $ls_rc -eq 0 ]]; then
      git fetch origin "${branch}:${branch}"
      info "分支已从远端拉取：${branch}（Huahua TC PR 已存在）"
    elif [[ $ls_rc -eq 2 ]]; then
      local base_ref
      base_ref="$(git show-ref --verify --quiet refs/remotes/origin/main && echo origin/main || echo main)"
      git branch "$branch" "$base_ref"
      info "分支已创建：${branch}（基于 ${base_ref}）"
    else
      err "git ls-remote origin 失败（exit ${ls_rc}）— 无法安全判断远端 ${branch} 是否存在，中止"
      exit 1
    fi
  fi

  git worktree add "$worktree_path" "$branch"
  ok "worktree 已创建：${worktree_path} → ${branch}"
}

# 移除 Menglan worktree（校验分支匹配后执行，幂等）
cmd_worktree_clean() {
  local req_id="${1:-}"
  if [[ -z "$req_id" ]]; then
    err "用法：./scripts/harness.sh worktree-clean <REQ-N>"
    exit 1
  fi
  local branch="feat/${req_id}"
  local worktree_path="$MENGLAN_WORKTREE_ROOT"

  if git worktree list | grep -qF "$worktree_path"; then
    # 安全检查：确认 worktree 确实绑定到该 REQ 的分支
    local current_branch
    current_branch="$(git -C "$worktree_path" branch --show-current 2>/dev/null || true)"
    if [[ "$current_branch" != "$branch" ]]; then
      err "worktree ${worktree_path} 当前在 ${current_branch:-unknown}，非 ${branch}，拒绝移除"
      err "如需强制移除，请直接运行：git worktree remove --force ${worktree_path}"
      exit 1
    fi
    git worktree remove --force "$worktree_path"
    ok "worktree 已移除：${worktree_path}（${branch}）"
  else
    info "worktree 不存在，跳过：${worktree_path}"
  fi
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

    if [[ "$status" == "confirmed" && ( "$owner" == "unassigned" || "$owner" == "${AGENT_ORCHESTRATOR}" ) ]]; then
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

  # worktree セットアップ（Menglan 専用作業ツリーを確保）
  cmd_worktree_setup "$req_id"

  info "触发 Claude Code 实现 ${req_id}..."
  log_session "implement" "$req_id"

  # Detect whether a TC PR was already opened by Huahua on this branch (single-PR rule, REQ-039).
  # EXISTING_BRANCH is set by menglan-heartbeat.sh when forwarding a tc_complete branch_name.
  local existing_branch_note=""
  if [[ -n "${EXISTING_BRANCH:-}" ]]; then
    existing_branch_note="
NOTE: A TC PR already exists for this branch (single-PR rule, REQ-039).
Do NOT run 'gh pr create'. Instead, after updating ${req_file} to status=review:
  existing_pr_number=\$(gh pr list --head feat/${req_id} --json number --jq '.[0].number' 2>/dev/null || echo '')
  If found: gh pr edit \$existing_pr_number --body '<implementation summary with TC and impl notes>'
  If not found (unexpected): gh pr create --fill
"
  fi

  local prompt
  prompt="Read CLAUDE.md and harness/harness-index.md.
Your task: implement ${req_id}.
Do not ask clarifying questions — proceed with your best judgment at every step.

Working directory for all git and npm operations: ${MENGLAN_WORKTREE_ROOT}
You are working in a git worktree (feat/${req_id}), not the main checkout.
Do NOT run git or npm commands from ~/workspace-pandas/open-workhorse/.
${existing_branch_note}
Steps:
1. Read ${req_file} and all test_case_ref TC files before writing any code
2. Read the current Phase doc in tasks/phases/ to confirm iteration boundary
3. Claim: in your working branch, update ${req_file}: owner=${AGENT_CODER}, status=in_progress, commit 'claim: ${req_id}'
4. Write tests first (or confirm TC is runnable), then implement
5. Before opening PR: npm run release:audit && npm run build && npm test
6. Update ${req_file}: status=review, fill Agent Notes with implementation notes
7. Open or update PR (see NOTE above if TC PR already exists)
8. Write the PR number back to ${req_file} frontmatter: pr_number: <N>
   (Pandas archive_merged_reqs depends on this field — do not skip)
   Commit message: 'chore: set pr_number for ${req_id}'
   Then push: git push (so the pr_number commit reaches the remote branch)
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
    if [[ "$b_owner" != "unassigned" && "$b_owner" != "${AGENT_ORCHESTRATOR}" ]]; then
      err "${bug_id} owner=${b_owner}，期望 owner=unassigned 或 owner=${AGENT_ORCHESTRATOR}（已被认领）"
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
2. First commit: update ${bug_file} only — owner=${AGENT_CODER}, status=in_progress, commit 'claim: ${bug_id}'
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
Address findings per review-standard.md §Finding 分级:
- [BLOCK] findings: MUST be fixed before merge — fix the code or doc
- [NIT] / [SUGGEST] findings: non-blocking — fix if straightforward, or reply explaining why not
- Untagged findings: treat as [BLOCK] (fail-safe)
- Do not silently ignore any finding — every comment needs either a fix or an explicit reply

Steps:
1. Read the referenced file+line for each inline comment
2. Apply fixes per the priority rules above
3. After all fixes are pushed:
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

  # Fetch full PR diff via gh (works for same-repo and fork PRs) — fail closed on error
  local pr_diff
  pr_diff="$(gh pr diff "$pr_num" 2>/dev/null)" || {
    err "无法获取 PR #${pr_num} diff — 检查 gh 认证和网络（tc-review 拒绝在无 diff 时执行）"
    exit 1
  }
  # NOTE: empty diff is allowed — impl-only PRs legitimately have no TC files in their diff.
  # TC files may already be on main (committed during tc_design phase); we load them below.

  # Load existing TC files for this REQ from origin/main (committed during tc_design phase).
  # These files are NOT in the PR diff when the PR only contains implementation code.
  # Without this, Claude sees impl code but no TCs and always returns NEEDS_CHANGES.
  local existing_tc_content=""
  if [[ -n "$req_hint" ]]; then
    local tc_pattern="tasks/test-cases/${req_hint}-*.md"
    local tc_files_found=""
    # Try git show from origin/main first (works even from a feature branch)
    while IFS= read -r tc_path; do
      local tc_body
      tc_body="$(git show "origin/main:${tc_path}" 2>/dev/null || true)"
      if [[ -n "$tc_body" ]]; then
        existing_tc_content+="### ${tc_path}
\`\`\`markdown
${tc_body}
\`\`\`

"
        tc_files_found="yes"
      fi
    done < <(git ls-tree -r --name-only origin/main -- "tasks/test-cases/" 2>/dev/null \
              | grep -E "^tasks/test-cases/${req_hint}-" || true)

    if [[ -z "$tc_files_found" ]]; then
      warn "origin/main 上未找到 ${req_hint} 的 TC 文件（pattern: ${tc_pattern}）"
    fi
  fi

  local prompt
  prompt="Read harness/testing-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

## Pre-fetched context for TC PR #${pr_num}${req_hint:+ (${req_hint})}

### REQ contract (acceptance criteria + test case design notes)
${req_contract:-"(REQ file not found — judge TCs against PR description only)"}

### Existing TC files on main (committed during tc_design phase — NOT in the PR diff)
Note: TC files are merged to main during the test-case design phase, BEFORE the
implementation PR is opened. The PR diff below contains only implementation code.
You MUST evaluate TC coverage using the TC files in this section, not the PR diff.
${existing_tc_content:-"(No TC files found on main for ${req_hint} — check tasks/test-cases/)"}

### Full PR diff (implementation code only — TC files will NOT appear here)
\`\`\`diff
${pr_diff:-"(empty diff — no changed files in this PR)"}
\`\`\`

### Existing review comments (may be empty if no prior review round)
${top_comments:-"(none)"}

### Inline review comments (may be empty)
${inline_comments:-"(none)"}

## Your task
Review TC coverage for PR #${pr_num}${req_hint:+ (${req_hint})} against the REQ contract above.

IMPORTANT: The TC files are listed under "Existing TC files on main" above.
The PR diff contains only implementation code — the absence of TC files in the diff
does NOT mean TCs are missing. Evaluate coverage using the TC files on main.

Each acceptance criterion in the REQ contract must be traceable to at least one TC.

For each TC in the "Existing TC files on main" section, label it exactly one of:
- **adequate** — covers the stated acceptance criterion
- **missing-branch** — acceptance criterion exists but no TC covers it
- **redundant** — duplicates another TC without adding coverage value

Rules:
1. Report findings only — do NOT modify any TC files
2. Do not ask clarifying questions
3. You MUST end your response with exactly one of these two lines (no trailing text):
   \`tc-review: APPROVED\`   — when all criteria are covered (all TCs adequate, no missing branches)
   \`tc-review: NEEDS_CHANGES\`   — when any criterion is uncovered or a TC is labelled missing-branch
4. The conclusion line is REQUIRED even if there are no prior review comments to address
"

  local review_output
  review_output="$("${CLAUDE_CMD[@]}" "$prompt")"
  local claude_rc=$?
  if [[ $claude_rc -ne 0 ]]; then
    err "claude 退出 ${claude_rc} — tc-review worker failure"
    exit 1
  fi
  # Fail closed: no conclusion line = non-compliant output, treat as worker failure
  if ! echo "$review_output" | grep -qE "tc-review: (APPROVED|NEEDS_CHANGES)"; then
    err "Claude 输出未包含 tc-review 结论行 — 视为 worker failure（拒绝假 NEEDS_CHANGES）"
    err "output tail: $(echo "$review_output" | tail -5)"
    exit 1
  fi
  echo "$review_output"
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
  worktree-setup)
    shift
    cmd_worktree_setup "${1:-}"
    ;;
  worktree-clean)
    shift
    cmd_worktree_clean "${1:-}"
    ;;
  "")
    echo "用法：./scripts/harness.sh <命令> [参数]"
    echo ""
    echo "命令："
    echo "  status                  列出当前可认领任务"
    echo "  implement <REQ-N>       Claude Code 认领并实现需求（自动创建 Menglan worktree）"
    echo "  worktree-setup <REQ-N>  创建 Menglan worktree（优先从远端拉取分支，REQ-039）"
  echo "  worktree-clean <REQ-N>  移除 Menglan worktree（PR merge 后调用）"
    echo "  bugfix <BUG-N>          Claude Code 认领并修复 Bug"
    echo "  fix-review <PR#>        Claude Code 修复 PR review comments"
    echo "  tc-review <PR#>         Menglan 评审 TC PR（adequate/missing-branch/redundant）"
    echo "  runbook [keyword]       列出 / 搜索 harness/runbook/ 条目"
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
