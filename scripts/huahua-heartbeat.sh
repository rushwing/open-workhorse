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

# ── Huahua 向 Pandas 写回 ATM response ─────────────────────────────────────
# _write_huahua_response <req_id> <pr_number> <legacy_type> <status> [summary]
# legacy_type: review_complete | review_blocked
# summary is always written as `summary:`; additionally written as `blocking_reason:` when status=blocked
_write_huahua_response() {
  local req_id="$1" pr_number="$2" legacy_type="$3" status="$4" summary="${5:-}"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-huahua-${legacy_type}-${req_id}-$$-${RANDOM}.md"
  mkdir -p "${INBOX_ROOT}/for-pandas/pending"
  {
    echo "---"
    echo "type: response"
    echo "from: huahua"
    echo "to: pandas"
    echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "priority: P1"
    echo "---"
    echo "legacy_type: ${legacy_type}"
    echo "req_id: ${req_id}"
    echo "pr_number: ${pr_number}"
    echo "status: ${status}"
    [[ -n "$summary" ]] && echo "summary: ${summary}"
    [[ "$status" == "blocked" && -n "$summary" ]] && echo "blocking_reason: ${summary}"
  } > "${INBOX_ROOT}/for-pandas/pending/${filename}"
  ok "${legacy_type}(${status}) → for-pandas/pending/${filename}"
}

# ── Huahua 向 Menglan 写 tc_review 请求 ────────────────────────────────────
# _write_tc_review_to_menglan <req_id> <tc_pr_number>
_write_tc_review_to_menglan() {
  local req_id="$1" tc_pr_number="$2"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-huahua-tc-review-${req_id}-$$-${RANDOM}.md"
  mkdir -p "${INBOX_ROOT}/for-menglan/pending"
  {
    echo "---"
    echo "type: request"
    echo "from: huahua"
    echo "to: menglan"
    echo "created_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "action: tc_review"
    echo "priority: P2"
    echo "---"
    echo "req_id: ${req_id}"
    echo "pr_number: ${tc_pr_number}"
  } > "${INBOX_ROOT}/for-menglan/pending/${filename}"
  ok "tc_review → for-menglan/pending/${filename}"
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
      info "code_review → claude review PR #${pr_number} for ${req_id}"
      local pr_diff=""
      pr_diff="$(gh pr diff "$pr_number" 2>/dev/null || echo "(unable to fetch diff)")"

      local _schema='{"type":"object","properties":{"verdict":{"type":"string","enum":["APPROVED","NEEDS_CHANGES"]},"summary":{"type":"string"}},"required":["verdict","summary"]}'
      local raw_result; local claude_rc
      raw_result=$("${CLAUDE_CMD[@]}" --output-format json --json-schema "$_schema" \
        "Read harness/harness-index.md.
Do not ask clarifying questions — proceed with your best judgment.

Your task: review dev PR #${pr_number} for ${req_id}.

## Diff
${pr_diff}

## Steps
1. Read the diff and any referenced files
2. Check for: bugs, regressions, unsafe assumptions, missing tests, data integrity risks
3. Post review using: gh pr review ${pr_number} --request-changes -b '<findings>'
   OR: gh pr review ${pr_number} --approve -b 'LGTM'
4. Return ONLY your structured verdict (do NOT write any inbox files — the harness handles that)." \
      2>&1); claude_rc=$?

      if [[ $claude_rc -ne 0 ]]; then
        warn "code_review: claude exited ${claude_rc}"
        return 1
      fi
      local verdict; verdict=$(echo "$raw_result" | jq -r '.structured_output.verdict // empty' 2>/dev/null)
      local summary; summary=$(echo "$raw_result" | jq -r '.structured_output.summary // empty' 2>/dev/null)
      if [[ -z "$verdict" ]]; then
        warn "code_review: 无法提取 verdict（jq 失败或输出格式异常）"
        return 1
      fi
      if [[ "$verdict" == "APPROVED" ]]; then
        _write_huahua_response "$req_id" "$pr_number" "review_complete" "completed" "${summary}"
      else
        _write_huahua_response "$req_id" "$pr_number" "review_blocked" "blocked" "${summary}"
      fi
      ;;
    req_review)
      info "req_review → claude 需求评审 ${req_id}"
      local req_file="tasks/features/${req_id}.md"
      local req_content=""
      [[ -f "$req_file" ]] && req_content="$(cat "$req_file")"

      local _schema='{"type":"object","properties":{"verdict":{"type":"string","enum":["PASSED","DEFECTS"]},"summary":{"type":"string"},"tc_pr_number":{"type":"string"}},"required":["verdict","summary"]}'
      local raw_result; local claude_rc
      raw_result=$("${CLAUDE_CMD[@]}" --output-format json --json-schema "$_schema" \
        "Read harness/harness-index.md and harness/requirement-standard.md.
Do not ask clarifying questions — proceed with your best judgment.

Your task: review requirements for ${req_id} and advance its status.

## REQ content
${req_content:-"(REQ file not found. Abort — return DEFECTS with summary explaining missing file.)"}

## Steps
1. Evaluate the REQ: acceptance criteria clarity, scope definition, frontmatter completeness
2. Run: bash scripts/check-req-coverage.sh
3. If REQ PASSES:
   a. Update tasks/features/${req_id}.md: status → ready, owner → huahua; commit
   b. Design TCs under tasks/test-cases/; update ${req_id}.md: status → test_designed, test_case_ref populated; commit
   c. Open TC PR: gh pr create --fill; capture PR number as tc_pr_number
   d. Return {\"verdict\":\"PASSED\",\"summary\":\"...\",\"tc_pr_number\":\"<N>\"}
4. If REQ has DEFECTS:
   a. Create tasks/bugs/BUG-NNN.md (bug_type: req_bug, related_req: [${req_id}])
   b. Block REQ: status → blocked, blocked_reason/blocked_from_status set; commit
   c. Return {\"verdict\":\"DEFECTS\",\"summary\":\"<one-line reason>\"}" \
      2>&1); claude_rc=$?

      if [[ $claude_rc -ne 0 ]]; then
        warn "req_review: claude exited ${claude_rc}"
        return 1
      fi
      local verdict; verdict=$(echo "$raw_result" | jq -r '.structured_output.verdict // empty' 2>/dev/null)
      local summary; summary=$(echo "$raw_result" | jq -r '.structured_output.summary // empty' 2>/dev/null)
      local tc_pr; tc_pr=$(echo "$raw_result" | jq -r '.structured_output.tc_pr_number // empty' 2>/dev/null)
      if [[ -z "$verdict" ]]; then
        warn "req_review: 无法提取 verdict"
        return 1
      fi
      if [[ "$verdict" == "PASSED" ]]; then
        if [[ -z "$tc_pr" ]]; then
          warn "req_review PASSED 但 tc_pr_number 为空 — 无法路由到 Menglan"
          return 1
        fi
        _write_tc_review_to_menglan "$req_id" "$tc_pr"
      else
        _write_huahua_response "$req_id" "" "review_blocked" "blocked" "${summary}"
      fi
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

# Guard: skip main() when script is sourced (for unit tests)
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

main "$@"
