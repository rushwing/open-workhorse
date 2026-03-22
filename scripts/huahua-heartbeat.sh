#!/usr/bin/env bash
# huahua-heartbeat.sh — Huahua inbox 心跳处理器
#
# 用法:
#   bash scripts/huahua-heartbeat.sh   # 由 cron 每 5 分钟调用
#
# 行为:
#   inbox 为空 → 立即退出（零 token，~0.001s CPU）
#   有消息    → 读取 type/req_id → 调用 harness.sh 或 claude -p 处理
#             成功 → 删除消息
#             失败 → 移至 dead-letter/ + 写 inbox/for-pandas/ 告警
#
# 依赖环境变量（.env）:
#   SHARED_RESOURCES_ROOT  — 共享收件箱根目录（默认 ~/Dev/everything_openclaw/personas/shared-resources）
#   REPO_ROOT              — open-workhorse 仓库根目录（自动检测）

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

# ── cron PATH 修复：确保 claude 和 node 可用 ──────────────────────────────────
export PATH="$HOME/.local/bin:$PATH"
if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  # source without --no-use so nvm activates the default version and adds its bin/ to PATH
  source "$HOME/.nvm/nvm.sh" 2>/dev/null || true
fi

# 加载 .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" =~ ^(SHARED_RESOURCES_ROOT|http_proxy|https_proxy|HTTP_PROXY|HTTPS_PROXY) ]] || continue
    local_var="${line%%=*}"
    [[ "${!local_var+X}" == "X" ]] && continue
    export "$line" 2>/dev/null || true
  done < "$REPO_ROOT/.env"
fi

INBOX_ROOT="${SHARED_RESOURCES_ROOT:-${HOME}/Dev/everything_openclaw/personas/shared-resources}/inbox"
INBOX="${INBOX_ROOT}/for-huahua"
DEAD_LETTER="${INBOX_ROOT}/dead-letter"

# ── 颜色（仅 TTY 输出时启用）────────────────────────────────────────────────
if [[ -t 1 ]]; then
  CYAN='\033[0;36m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
else
  CYAN=''; YELLOW=''; GREEN=''; NC=''
fi
info() { echo -e "${CYAN}[huahua]${NC} $*"; }
warn() { echo -e "${YELLOW}[huahua]${NC} $*"; }
ok()   { echo -e "${GREEN}[huahua]${NC} $*"; }

_get_fm_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# ── 任务状态回退（防止任务卡死在 in_progress）────────────────────────────────
# REQ → status=blocked  （REQ 状态机允许 blocked）
# BUG → status=confirmed（BUG 状态机：open/confirmed/in_progress/fixed/… 无 blocked）
_rollback_task() {
  local req_id="$1"
  local task_file="" rollback_status
  # 确定回退状态和文件路径
  if [[ "$req_id" == BUG-* ]]; then
    rollback_status="confirmed"
    task_file="$REPO_ROOT/tasks/bugs/${req_id}.md"
  else
    rollback_status="blocked"
    task_file="$REPO_ROOT/tasks/features/${req_id}.md"
  fi
  if [[ ! -f "$task_file" ]]; then
    warn "rollback: 找不到任务文件 ${req_id}，跳过回退"
    return 0
  fi
  sed -i \
    -e "s/^status: .*/status: ${rollback_status}/" \
    -e 's/^owner: .*/owner: unassigned/' \
    "$task_file"
  warn "rollback: ${req_id} → status=${rollback_status}, owner=unassigned"
}

# ── Failsafe: 失败通知 Pandas ─────────────────────────────────────────────────
_notify_pandas_failure() {
  local msg_basename="$1" reason="$2" req_id="$3"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-huahua-fail-${req_id}-$$-${RANDOM}.md"
  # REQ-034: write to pending/ so pandas heartbeat picks it up via atomic-claim path
  mkdir -p "${INBOX_ROOT}/for-pandas/pending"
  {
    echo "---"
    echo "type: major_decision_needed"
    echo "req_id: ${req_id}"
    echo "summary: huahua-heartbeat 处理失败 — ${msg_basename}"
    echo "status: blocked"
    echo "blocking_reason: ${reason}; task reset to blocked/unassigned — review before re-dispatching"
    echo "---"
  } > "${INBOX_ROOT}/for-pandas/pending/${filename}"
  warn "已写入失败告警 → for-pandas/pending/${filename}"
}

# ── 单条消息处理（在 if 内调用，不触发 set -e 退出）──────────────────────────
_process_message() {
  local msg_file="$1"
  local type req_id pr_number summary status
  type="$(_get_fm_field "$msg_file" "type")"
  req_id="$(_get_fm_field "$msg_file" "req_id")"
  pr_number="$(_get_fm_field "$msg_file" "pr_number")"
  summary="$(_get_fm_field "$msg_file" "summary")"
  status="$(_get_fm_field "$msg_file" "status")"

  info "处理消息: type=${type} req_id=${req_id} pr=${pr_number:-none} status=${status:-none}"
  info "summary: ${summary}"

  # harness.sh CLAUDE_CMD setup
  CLAUDE_CMD=(claude --dangerously-skip-permissions -p)
  if [[ -n "${CLAUDE_APPROVAL+x}" && -z "${CLAUDE_APPROVAL}" ]]; then
    CLAUDE_CMD=(claude -p)
  elif [[ -n "${CLAUDE_APPROVAL:-}" ]]; then
    CLAUDE_CMD=(claude "$CLAUDE_APPROVAL" -p)
  fi

  # ATM Envelope 兼容路由：type=request → 按 action 规范化为 legacy type，统一走下方 case
  local resolved_type="$type"
  if [[ "$type" == "request" ]]; then
    local action_val; action_val="$(_get_fm_field "$msg_file" "action")"
    # pr_number 可能在 payload（ATM 格式），补读一次
    [[ -z "$pr_number" ]] && pr_number="$(_get_fm_field "$msg_file" "pr_number")"
    case "$action_val" in
      review|code_review) resolved_type="code_review" ;;
      tc_design)          resolved_type="tc_design" ;;
      req_review)         resolved_type="req_review" ;;
      *)
        warn "ATM request action=${action_val} — 暂无专用 handler，移至 dead-letter"
        return 1
        ;;
    esac
    info "ATM request action=${action_val} → resolved type=${resolved_type}"
  fi

  case "$resolved_type" in
    tc_design)
      # tc_design with pr_number = fix findings on existing TC PR (PANDAS-ORCHESTRATION §7)
      # tc_design without pr_number = design TCs from scratch and open a TC PR
      if [[ -n "$pr_number" ]]; then
        info "tc_design (fix iteration) → harness.sh fix-review ${pr_number}"
        bash "$REPO_ROOT/scripts/harness.sh" fix-review "$pr_number"
      else
        info "tc_design (initial) → claude -p TC design for ${req_id}"
        local req_file="tasks/features/${req_id}.md"
        local req_content=""
        [[ -f "$req_file" ]] && req_content="$(cat "$req_file")"
        "${CLAUDE_CMD[@]}" "Read harness/harness-index.md and harness/testing-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

Your task: design test cases for ${req_id} and open a TC PR.

## REQ content
${req_content:-"(REQ file not found at ${req_file}. Use the req_id to locate it.)"}

## Steps
1. Create branch: tc/${req_id}-<short-slug>
2. Read the REQ acceptance criteria carefully
3. For each acceptance criterion, write at least one test case file under tasks/test-cases/
4. Commit TC files with message: 'tc: ${req_id} test case design'
5. Open PR with: gh pr create --fill
6. Reply summary of TCs designed and the PR URL"
      fi
      ;;
    code_review)
      # code_review = Huahua reviews Menglan's dev PR (PANDAS-ORCHESTRATION §8)
      if [[ -z "$pr_number" ]]; then
        warn "code_review 消息缺少 pr_number — 移至 dead-letter"
        return 1
      fi
      info "code_review → claude -p review PR #${pr_number} for ${req_id}"
      local pr_diff=""
      pr_diff="$(gh pr diff "$pr_number" 2>/dev/null || echo "(unable to fetch diff)")"
      "${CLAUDE_CMD[@]}" "Read harness/harness-index.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

Your task: review dev PR #${pr_number} for ${req_id}.

## Diff
${pr_diff}

## Steps
1. Read the diff above and any referenced files
2. Check for: bugs, regressions, unsafe assumptions, missing tests, data integrity risks
3. Post review using: gh pr review ${pr_number} --request-changes -b '<findings>' OR gh pr review ${pr_number} --approve -b 'LGTM'
4. If approved, write ATM response to for-pandas/ inbox. File content:
   ---
   type: response
   from: huahua
   to: pandas
   created_at: <ISO8601 UTC>
   priority: P1
   ---
   legacy_type: review_complete
   req_id: ${req_id}
   pr_number: ${pr_number}
   status: completed
   summary: code review approved for ${req_id}
5. If changes requested, write ATM response to for-pandas/ inbox. File content:
   ---
   type: response
   from: huahua
   to: pandas
   created_at: <ISO8601 UTC>
   priority: P1
   ---
   legacy_type: review_blocked
   req_id: ${req_id}
   pr_number: ${pr_number}
   status: blocked
   blocking_reason: <summary of findings>"
      ;;
    req_review)
      info "req_review → claude -p 需求评审 ${req_id}"
      local req_file="tasks/features/${req_id}.md"
      local req_content=""
      [[ -f "$req_file" ]] && req_content="$(cat "$req_file")"
      "${CLAUDE_CMD[@]}" "Read harness/harness-index.md and harness/requirement-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

Your task: review the requirements for ${req_id} and advance its status.

## REQ content
${req_content:-"(REQ file not found at ${req_file}. Abort and write a failure notice to inbox/for-pandas/pending/)"}

## Steps
1. Evaluate the REQ: acceptance criteria clarity, scope definition, frontmatter completeness
2. Run: bash scripts/check-req-coverage.sh
3. If REQ PASSES review (acceptance clear, scope well-defined, frontmatter valid):
   a. Update tasks/features/${req_id}.md: status → ready, owner → huahua
   b. Commit: 'req-review: ${req_id} passed → ready'
   c. Design test cases: create TC files under tasks/test-cases/ following harness/testing-standard.md
   d. Update ${req_id}.md: status → test_designed, test_case_ref populated
   e. Commit: 'tc: ${req_id} test case design'
   f. Open TC PR: gh pr create --fill
   g. Write ATM message to inbox/for-menglan/pending/ (type: request, action: tc_design, req_id: ${req_id})
4. If REQ has DEFECTS (unclear acceptance, scope ambiguity, missing required fields):
   a. Determine next BUG ID: ls tasks/bugs/ | sort | tail -1
   b. Create tasks/bugs/BUG-NNN.md with bug_type: req_bug, related_req: [${req_id}], status: open
   c. Update ${req_id}.md: status → blocked, blocked_reason: req_review_feedback, blocked_from_status: req_review, blocked_from_owner: huahua, owner → unassigned; add BUG-NNN to pending_bugs
   d. Commit: 'bug-block: ${req_id} blocked by BUG-NNN'
   e. Reply summary to inbox/for-pandas/pending/ (type: response, legacy_type: review_blocked, req_id: ${req_id}, status: blocked, blocking_reason: <one-line summary>)"
      ;;
    *)
      warn "未知消息类型: ${resolved_type} — 移至 dead-letter"
      return 1
      ;;
  esac
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
main() {
  # 空则秒退（零 token）— 检查 pending/ 和扁平目录
  local msg
  msg=$(ls "${INBOX}/pending"/*.md "${INBOX}"/*.md 2>/dev/null | head -1 || true)
  [[ -z "$msg" ]] && exit 0

  info "huahua-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  local pending_dir="${INBOX}/pending"
  local claimed_dir="${INBOX}/claimed"
  local done_dir="${INBOX}/done"
  local failed_dir="${INBOX}/failed"
  mkdir -p "$claimed_dir" "$done_dir" "$failed_dir"

  # ── A. 处理 pending/（原子 claim）────────────────────────────────────────
  if [[ -d "$pending_dir" ]]; then
    for msg_file in "${pending_dir}"/*.md; do
      [[ -f "$msg_file" ]] || continue
      local base; base="$(basename "$msg_file")"
      if ! mv "$msg_file" "${claimed_dir}/${base}" 2>/dev/null; then
        [[ ! -f "$msg_file" ]] && continue  # genuine race: source gone
        warn "Claim mv 失败（非竞争错误），跳过: ${base}"; continue
      fi
      local req_id; req_id="$(_get_fm_field "${claimed_dir}/${base}" "req_id")"
      local msg_type; msg_type="$(_get_fm_field "${claimed_dir}/${base}" "type")"

      if _process_message "${claimed_dir}/${base}"; then
        mv "${claimed_dir}/${base}" "${done_dir}/${base}"
        ok "done: ${base}"
      else
        local pm_exit=$?
        mv "${claimed_dir}/${base}" "${failed_dir}/${base}" 2>/dev/null || true
        printf '\nERROR: handler failed — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          >> "${failed_dir}/${base}"
        # code_review 失败时 REQ 已在 review 状态，不回退
        local skip_rollback=false
        [[ "$msg_type" == "code_review" ]] && skip_rollback=true
        if [[ "$msg_type" == "request" ]]; then
          local _action_rb; _action_rb="$(_get_fm_field "${failed_dir}/${base}" "action")"
          [[ "$_action_rb" == "review" || "$_action_rb" == "code_review" ]] && skip_rollback=true
        fi
        [[ "$skip_rollback" == "false" ]] && _rollback_task "$req_id"
        _notify_pandas_failure "$base" \
          "exit ${pm_exit} — see ${failed_dir}/${base}" "$req_id"
      fi
    done
  fi

  # ── B. 旧格式 flat（向后兼容）────────────────────────────────────────────
  for msg_file in "${INBOX}"/*.md; do
    [[ -f "$msg_file" ]] || continue
    local req_id msg_type
    req_id="$(_get_fm_field "$msg_file" "req_id")"
    msg_type="$(_get_fm_field "$msg_file" "type")"

    if _process_message "$msg_file"; then
      rm -f "$msg_file"
      ok "消费消息: $(basename "$msg_file")"
    else
      local exit_code=$?
      warn "处理失败 (exit ${exit_code}): $(basename "$msg_file")"
      mkdir -p "$DEAD_LETTER"
      mv "$msg_file" "${DEAD_LETTER}/"
      ok "已移至 dead-letter: $(basename "$msg_file")"
      # code_review 和 ATM request action=review/code_review：失败时 REQ 已在 review 状态，不回退
      # 其他类型（tc_design 等）仍执行回退
      local skip_rollback=false
      [[ "$msg_type" == "code_review" ]] && skip_rollback=true
      if [[ "$msg_type" == "request" ]]; then
        local _action_rb; _action_rb="$(_get_fm_field "$msg_file" "action")"
        [[ "$_action_rb" == "review" || "$_action_rb" == "code_review" ]] && skip_rollback=true
      fi
      if [[ "$skip_rollback" == "false" ]]; then
        _rollback_task "$req_id"
      fi
      _notify_pandas_failure "$(basename "$msg_file")" \
        "exit ${exit_code} — 详见 ${DEAD_LETTER}/$(basename "$msg_file")" \
        "$req_id"
    fi
  done

  info "huahua-heartbeat 完成"
}

main "$@"
