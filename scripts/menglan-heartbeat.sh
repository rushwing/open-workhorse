#!/usr/bin/env bash
# menglan-heartbeat.sh — Menglan inbox 心跳处理器
#
# 用法:
#   bash scripts/menglan-heartbeat.sh   # 由 cron 每 5 分钟调用
#
# 行为:
#   inbox 为空 → 立即退出（零 token，~0.001s CPU）
#   有消息    → 读取 type/req_id → 调用 harness.sh 处理
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
# nvm node（激活默认版本，将其 bin/ 加入 PATH）
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
INBOX="${INBOX_ROOT}/for-menglan"
DEAD_LETTER="${INBOX_ROOT}/dead-letter"

# ── 颜色（仅 TTY 输出时启用）────────────────────────────────────────────────
if [[ -t 1 ]]; then
  CYAN='\033[0;36m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
else
  CYAN=''; YELLOW=''; GREEN=''; NC=''
fi
info() { echo -e "${CYAN}[menglan]${NC} $*"; }
warn() { echo -e "${YELLOW}[menglan]${NC} $*"; }
ok()   { echo -e "${GREEN}[menglan]${NC} $*"; }

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

# ── tc_complete 回报 Pandas ───────────────────────────────────────────────────
# _write_tc_complete <req_id> <pr_number> <status> [blocking_reason] [branch_name] [iteration]
# 向 inbox/for-pandas/pending/ 写入 tc_complete response，供 Pandas _handle_tc_complete 处理
# branch_name: 非空时携带共用 PR 分支名（REQ-039 单 PR 规则）
# iteration: 当前 TC review 轮次（透传给 Pandas 用于判断是否升级决策）
_write_tc_complete() {
  local req_id="$1" pr_number="$2" status="$3" blocking_reason="${4:-}" branch_name="${5:-}" iteration="${6:-0}"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-menglan-tc-complete-${req_id}-$$-${RANDOM}.md"
  mkdir -p "${INBOX_ROOT}/for-pandas/pending"
  {
    echo "---"
    echo "type: response"
    echo "from: menglan"
    echo "to: pandas"
    echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "priority: P1"
    echo "---"
    echo "legacy_type: tc_complete"
    echo "req_id: ${req_id}"
    echo "pr_number: ${pr_number}"
    echo "status: ${status}"
    [[ -n "$blocking_reason" ]] && echo "blocking_reason: ${blocking_reason}"
    [[ -n "$branch_name" ]]     && echo "branch_name: ${branch_name}"
    echo "iteration: ${iteration}"
  } > "${INBOX_ROOT}/for-pandas/pending/${filename}"
  ok "tc_complete(${status}) → for-pandas/pending/${filename}"
}

# ── code_review 派发给 Huahua ─────────────────────────────────────────────────
# _write_code_review_to_huahua <req_id> <pr_number> <iteration>
# 向 inbox/for-huahua/pending/ 写入 code_review request，供 Huahua code_review handler 处理
_write_code_review_to_huahua() {
  local req_id="$1" pr_number="$2" iteration="${3:-0}"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-menglan-code-review-${req_id}-$$-${RANDOM}.md"
  mkdir -p "${INBOX_ROOT}/for-huahua/pending"
  {
    echo "---"
    echo "type: request"
    echo "from: menglan"
    echo "to: huahua"
    echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "action: code_review"
    echo "priority: P1"
    echo "---"
    echo "req_id: ${req_id}"
    echo "pr_number: ${pr_number}"
    echo "iteration: ${iteration}"
  } > "${INBOX_ROOT}/for-huahua/pending/${filename}"
  ok "code_review(iter=${iteration}) → for-huahua/pending/${filename}"
}

# ── Failsafe: 失败通知 Pandas ─────────────────────────────────────────────────
_notify_pandas_failure() {
  local msg_basename="$1" reason="$2" req_id="$3"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-menglan-fail-${req_id}-$$-${RANDOM}.md"
  # REQ-034: write to pending/ so pandas heartbeat picks it up via atomic-claim path
  mkdir -p "${INBOX_ROOT}/for-pandas/pending"
  {
    echo "---"
    echo "type: major_decision_needed"
    echo "req_id: ${req_id}"
    echo "summary: menglan-heartbeat 处理失败 — ${msg_basename}"
    echo "status: blocked"
    echo "blocking_reason: ${reason}; task reset to blocked/unassigned — review before re-dispatching"
    echo "---"
  } > "${INBOX_ROOT}/for-pandas/pending/${filename}"
  warn "已写入失败告警 → for-pandas/pending/${filename}"
}

# ── 单条消息处理（在 if 内调用，不触发 set -e 退出）──────────────────────────
_process_message() {
  local msg_file="$1"
  local type req_id summary
  type="$(_get_fm_field "$msg_file" "type")"
  req_id="$(_get_fm_field "$msg_file" "req_id")"
  summary="$(_get_fm_field "$msg_file" "summary")"

  # ATM normalization: type=request → resolve to legacy type via action field
  if [[ "$type" == "request" ]]; then
    local action
    action="$(_get_fm_field "$msg_file" "action")"
    case "$action" in
      implement)  type="implement"  ;;
      fix_review) type="fix_review" ;;
      bugfix)     type="bugfix"     ;;
      tc_review)  type="tc_review"  ;;
      *) warn "ATM request action=${action} 未识别 — 继续按 type 路由（将触发 unknown 分支）" ;;
    esac
    info "ATM normalize: action=${action} → type=${type}"
  fi

  info "处理消息: type=${type} req_id=${req_id}"
  info "summary: ${summary}"

  case "$type" in
    implement)
      # Pandas already claimed the task (owner=claude_code, status=in_progress).
      # FORCE=true bypasses the claim gate. (PANDAS-ORCHESTRATION §2 DEV_ACTIVE)
      # REQ-039: if branch_name is set, pass as EXISTING_BRANCH so harness.sh reuses Huahua's TC branch
      local impl_branch_name
      impl_branch_name="$(_get_fm_field "$msg_file" "branch_name")"
      info "路由 implement → FORCE=true harness.sh implement ${req_id}${impl_branch_name:+ (EXISTING_BRANCH=${impl_branch_name})}"
      FORCE=true EXISTING_BRANCH="$impl_branch_name" bash "$REPO_ROOT/scripts/harness.sh" implement "$req_id"
      # After implement success: dispatch code_review directly to Huahua (direct-loop design).
      # Fail-closed: Pandas is no longer on the review-dispatch path, so a missed
      # dispatch has no automatic retry. Return 1 so Pandas is notified to intervene.
      local impl_pr_num impl_gh_rc
      impl_pr_num="$(gh pr list --head "feat/${req_id}" --state open --json number --jq '.[0].number' 2>/dev/null)"
      impl_gh_rc=$?
      if [[ $impl_gh_rc -ne 0 ]]; then
        warn "implement 完成但 gh pr list 失败 (exit ${impl_gh_rc}) — code_review 未派发"
        return 1
      fi
      if [[ -z "$impl_pr_num" ]]; then
        warn "implement 完成但未找到开放 PR (feat/${req_id}) — code_review 未派发"
        return 1
      fi
      _write_code_review_to_huahua "$req_id" "$impl_pr_num" "0"
      ;;
    fix_review)
      # Huahua requested fixes; Menglan applies them and re-dispatches code_review
      local fpr_number fix_iteration
      fpr_number="$(_get_fm_field "$msg_file" "pr_number")"
      fix_iteration="$(_get_fm_field "$msg_file" "iteration")"
      if [[ -z "$fpr_number" ]]; then
        warn "fix_review 消息缺少 pr_number — 移至 dead-letter"
        return 1
      fi
      info "路由 fix_review → harness.sh fix-review ${fpr_number} (iteration=${fix_iteration:-0})"
      if bash "$REPO_ROOT/scripts/harness.sh" fix-review "$fpr_number"; then
        _write_code_review_to_huahua "$req_id" "$fpr_number" "${fix_iteration:-0}"
      else
        warn "harness.sh fix-review 非零退出 — 跳过 code_review 重派"
        return 1
      fi
      ;;
    bugfix)
      info "路由 bugfix → harness.sh bugfix ${req_id}"
      bash "$REPO_ROOT/scripts/harness.sh" bugfix "$req_id"
      ;;
    tc_review)
      local pr_number
      pr_number="$(_get_fm_field "$msg_file" "pr_number")"
      if [[ -z "$pr_number" ]]; then
        warn "tc_review 消息缺少 pr_number — 移至 dead-letter"
        return 1
      fi
      # REQ-039: preserve branch_name from tc_review message → forward to Pandas via tc_complete
      local tc_branch_name
      tc_branch_name="$(_get_fm_field "$msg_file" "branch_name")"
      # iteration: read from message and forward to Pandas via tc_complete for escalation logic
      local tc_iteration
      tc_iteration="$(_get_fm_field "$msg_file" "iteration")"
      info "路由 tc_review → harness.sh tc-review ${pr_number} (iteration=${tc_iteration:-0})"
      local review_output review_rc
      review_output="$(bash "$REPO_ROOT/scripts/harness.sh" tc-review "$pr_number" 2>&1)"
      review_rc=$?
      # Non-zero exit = infrastructure/runtime failure (bad PR#, gh auth, Claude crash).
      # Treat as worker failure: route to failed/ so Pandas sees a proper error notice.
      if [[ $review_rc -ne 0 ]]; then
        warn "harness.sh tc-review exited ${review_rc} — routing to failed/ (worker failure, not TC feedback)"
        return 1
      fi
      # Zero exit: parse Claude's conclusion line to determine pass/fail
      local tc_status="blocked" tc_blocking=""
      if echo "$review_output" | grep -q "tc-review: APPROVED"; then
        tc_status="success"
      else
        tc_blocking="$(echo "$review_output" | grep -oE 'tc-review: NEEDS_CHANGES[^\n]*' | head -1 || echo 'TC changes required — see review output')"
      fi
      _write_tc_complete "$req_id" "$pr_number" "$tc_status" "$tc_blocking" "$tc_branch_name" "${tc_iteration:-0}"
      ;;
    *)
      warn "未知消息类型: ${type} — 移至 dead-letter"
      return 1
      ;;
  esac
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
main() {
  # REQ-039: 写存活时间戳（供 Pandas keep-alive watchdog 检测，在早退前写入）
  mkdir -p "${REPO_ROOT}/runtime"
  date +%s > "${REPO_ROOT}/runtime/menglan_alive.ts" 2>/dev/null || true

  # 空则秒退（零 token）— 检查 pending/ 和扁平目录
  local msg
  msg=$(ls "${INBOX}/pending"/*.md "${INBOX}"/*.md 2>/dev/null | head -1 || true)
  [[ -z "$msg" ]] && exit 0

  info "menglan-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  # 同步远端 main（仅 fetch，不 merge，确保本地缓存最新；worktree 独立不受影响）
  git -C "$REPO_ROOT" fetch origin main --quiet 2>/dev/null \
    || warn "git fetch origin main 失败，继续使用本地缓存"

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
      if _process_message "${claimed_dir}/${base}"; then
        mv "${claimed_dir}/${base}" "${done_dir}/${base}"
        ok "done: ${base}"
      else
        local pm_exit=$?
        mv "${claimed_dir}/${base}" "${failed_dir}/${base}" 2>/dev/null || true
        printf '\nERROR: handler failed — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          >> "${failed_dir}/${base}"
        _rollback_task "$req_id"
        _notify_pandas_failure "$base" \
          "exit ${pm_exit} — see ${failed_dir}/${base}" "$req_id"
      fi
    done
  fi

  # ── B. 旧格式 flat（向后兼容）────────────────────────────────────────────
  for msg_file in "${INBOX}"/*.md; do
    [[ -f "$msg_file" ]] || continue
    local req_id; req_id="$(_get_fm_field "$msg_file" "req_id")"

    if _process_message "$msg_file"; then
      rm -f "$msg_file"
      ok "消费消息: $(basename "$msg_file")"
    else
      local exit_code=$?
      warn "处理失败 (exit ${exit_code}): $(basename "$msg_file")"
      mkdir -p "$DEAD_LETTER"
      mv "$msg_file" "${DEAD_LETTER}/"
      ok "已移至 dead-letter: $(basename "$msg_file")"
      _rollback_task "$req_id"
      _notify_pandas_failure "$(basename "$msg_file")" \
        "exit ${exit_code} — 详见 ${DEAD_LETTER}/$(basename "$msg_file")" \
        "$req_id"
    fi
  done

  info "menglan-heartbeat 完成"
}

# Guard: skip main() when script is sourced (for unit tests)
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

main "$@"
