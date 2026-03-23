#!/usr/bin/env bash
# pandas-heartbeat.sh — Pandas 编排循环心跳处理器
#
# 用法:
#   bash scripts/pandas-heartbeat.sh   # 由 APP_COMMAND=pandas-heartbeat 从 src/index.ts 调用
#
# 职责（按顺序）：
#   1. 初始化 inbox 目录结构
#   2. 处理 inbox/for-pandas/ 中的所有消息（REQ-021, REQ-023）
#   3. 处理 Telegram 指令（REQ-024）
#   4. Auto-claim：认领最高优先级未认领任务（REQ-022）
#   5. 停滞检测：超阈值则 Telegram 告警（REQ-022）
#
# 依赖环境变量（.env）：
#   SHARED_RESOURCES_ROOT    — 共享收件箱根目录（默认 ~/Dev/everything_openclaw/personas/shared-resources）
#   TELEGRAM_BOT_TOKEN       — Telegram Bot token
#   TELEGRAM_CHAT_ID         — Daniel's chat ID
#   DEV_WATCHDOG_STALE_HOURS — 停滞阈值（默认 4）

set -euo pipefail

# Support being sourced (for unit tests); REPO_ROOT can be pre-set via env
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

# 加载 .env（已在环境中设置的变量不覆盖，使 test 注入的值优先）
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" =~ ^(SHARED_RESOURCES_ROOT|TELEGRAM_|DEV_WATCHDOG_|GITHUB_REPO|http_proxy|https_proxy|HTTP_PROXY|HTTPS_PROXY) ]] || continue
    local_var="${line%%=*}"
    # Skip if already set in environment (env wins over .env file)
    [[ "${!local_var+X}" == "X" ]] && continue
    export "$line" 2>/dev/null || true
  done < "$REPO_ROOT/.env"
fi

# 引入 Telegram 函数（REQ-024）
# shellcheck source=scripts/telegram.sh
if [[ -f "$REPO_ROOT/scripts/telegram.sh" ]]; then
  source "$REPO_ROOT/scripts/telegram.sh" 2>/dev/null || true
fi

# ── 颜色（仅 TTY 输出时启用）────────────────────────────────────────────────
if [[ -t 1 ]]; then
  CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
else
  CYAN=''; YELLOW=''; RED=''; GREEN=''; NC=''
fi
info()  { echo -e "${CYAN}[pandas]${NC} $*"; }
warn()  { echo -e "${YELLOW}[pandas]${NC} $*" >&2; }
err()   { echo -e "${RED}[pandas]${NC} $*" >&2; }
ok()    { echo -e "${GREEN}[pandas]${NC} $*"; }

# ── REQ-021: 共享收件箱路径 ─────────────────────────────────────────────────
INBOX_ROOT="${SHARED_RESOURCES_ROOT:-${HOME}/Dev/everything_openclaw/personas/shared-resources}/inbox"

# ── REQ-024: hold 标志文件 ────────────────────────────────────────────────────
HOLD_FLAG="${REPO_ROOT}/.pandas_hold"

# ── REQ-021: 收件箱 IPC 函数 ─────────────────────────────────────────────────

# inbox_init — 确保 inbox 目录结构存在（REQ-034：含四级生命周期子目录）
inbox_init() {
  for agent in pandas huahua menglan; do
    mkdir -p \
      "${INBOX_ROOT}/for-${agent}/pending" \
      "${INBOX_ROOT}/for-${agent}/claimed" \
      "${INBOX_ROOT}/for-${agent}/done" \
      "${INBOX_ROOT}/for-${agent}/failed"
  done
}

# @deprecated — 旧 inbox 格式，逐步迁移到 inbox_write_v2()（REQ-033）
# 仍可调用，内部透传到 inbox_write_v2()（向后兼容）
# inbox_write <target> <type> <req_id> <summary> [pr_number] [status] [blocking_reason] [iteration] [body]
inbox_write() {
  local target="$1"
  local type="$2"
  local req_id="$3"
  local summary="$4"
  local pr_number="${5:-}"
  local status="${6:-success}"
  local blocking_reason="${7:-}"
  local iteration="${8:-}"
  local body="${9:-}"

  # 生成兼容 thread_id / correlation_id（REQ-035：thread 复用，corr 唯一）
  local thread_id; thread_id="$(thread_get_or_create "$req_id")"
  local correlation_id; correlation_id="$(correlation_new "$req_id")"

  # 旧 type → 新 type/action 映射
  # code_review 规范化为 review（Daniel 决策 2026-03-20）
  local new_type action_or_event
  case "$type" in
    implement|tc_design|review|code_review|bugfix|fix_review|escalate|clarify|req_review)
      new_type="request"
      # code_review → review（canonical action）
      [[ "$type" == "code_review" ]] && action_or_event="review" || action_or_event="$type"
      ;;
    dev_complete|tc_complete|review_blocked)
      new_type="response"; action_or_event="" ;;
    major_decision_needed)
      new_type="notification"; action_or_event="decision_required" ;;
    *)
      new_type="notification"; action_or_event="$type" ;;
  esac

  # 构造 payload_file（legacy 字段 + body）
  local tmpfile; tmpfile="$(mktemp)"
  {
    echo "req_id: ${req_id}"
    echo "summary: ${summary}"
    echo "status: ${status}"
    # legacy_type: 保留原始 type，供 response 路由区分 tc_complete / dev_complete
    echo "legacy_type: ${type}"
    [[ -n "$pr_number" ]]       && echo "pr_number: ${pr_number}"
    [[ -n "$blocking_reason" ]] && echo "blocking_reason: ${blocking_reason}"
    [[ -n "$iteration" ]]       && echo "iteration: ${iteration}"
    [[ -n "$body" ]] && echo "" && echo "$body"
  } > "$tmpfile"

  # Pass status (param 10) so response envelope frontmatter includes status field
  inbox_write_v2 "$target" "$new_type" "$action_or_event" \
    "$thread_id" "$correlation_id" "" "P2" "false" "$tmpfile" \
    "$status"
  rm -f "$tmpfile"
}

# inbox_write_v2 <target> <type> <action_or_event> <thread_id> <correlation_id>
#                [in_reply_to] [priority] [response_required] [payload_file]
#                [status] [severity] [summary]
#
# type:            request | response | notification
# action_or_event: request → action verb; notification → event_type; response → ""
# status:          response only — completed | partial | blocked | failed | rejected | deferred
# severity:        notification only — info | warn | action-required
# summary:         response only — optional free-text summary
# payload_file:    临时文件，含 type-specific 附加字段 + Markdown body（可选）
inbox_write_v2() {
  local target="$1"
  local type="$2"
  local action_or_event="$3"
  local thread_id="$4"
  local correlation_id="$5"
  local in_reply_to="${6:-}"
  local priority="${7:-P2}"
  local response_required="${8:-false}"
  local payload_file="${9:-}"
  local status="${10:-}"
  local severity="${11:-}"
  local summary="${12:-}"

  local now msg_id date_str filename target_dir
  now="$(date -u +%Y%m%d%H%M%S)"
  # Use subshell with pipefail disabled to avoid SIGPIPE when head closes the pipe
  local rand4; rand4="$(set +o pipefail; tr -dc 'a-z0-9' < /dev/urandom 2>/dev/null | head -c 4)"
  msg_id="msg_${AGENT_ORCHESTRATOR:-pandas}_${now}_${rand4}"
  date_str="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  # REQ-036: canonical filename — {timestamp}_{type}_{from}_to_{to}_{corr_or_evt}.md
  local corr_or_evt
  case "$type" in
    notification) corr_or_evt="evt_${action_or_event}_${now}" ;;
    *)            corr_or_evt="${correlation_id:-notset}" ;;
  esac
  filename="${now}_${type}_${AGENT_ORCHESTRATOR:-pandas}_to_${target}_${corr_or_evt}.md"
  # REQ-034: write to pending/ sub-directory for atomic claim lifecycle
  target_dir="${INBOX_ROOT}/for-${target}/pending"
  mkdir -p "$target_dir"

  # REQ-036: delegation field validation (type=request only)
  local delegation_incomplete=false
  if [[ "$type" == "request" ]]; then
    if [[ -n "$payload_file" && -f "$payload_file" ]]; then
      local _missing_fields=()
      for _field in objective scope expected_output done_criteria; do
        grep -q "^${_field}:" "$payload_file" || _missing_fields+=("$_field")
      done
      if [[ ${#_missing_fields[@]} -gt 0 ]]; then
        warn "inbox_write_v2: delegation incomplete — missing: ${_missing_fields[*]}"
        delegation_incomplete=true
      fi
    else
      warn "inbox_write_v2: delegation incomplete — no payload_file for type=request"
      delegation_incomplete=true
    fi
  fi

  # REQ-036: context_summary truncation (>500 chars → truncate + warn)
  local effective_payload="$payload_file"
  if [[ -n "$payload_file" && -f "$payload_file" ]]; then
    local _cs_val
    _cs_val="$(awk '/^context_summary:/{sub(/^context_summary:[[:space:]]*/,""); print; exit}' "$payload_file")"
    if [[ ${#_cs_val} -gt 500 ]]; then
      warn "inbox_write_v2: context_summary truncated from ${#_cs_val} to 500 chars"
      local _tmp_payload; _tmp_payload="$(mktemp)"
      awk '/^context_summary:/{printf "context_summary: %s\n", substr($0, index($0, ": ")+2, 500); next} {print}' \
        "$payload_file" > "$_tmp_payload"
      effective_payload="$_tmp_payload"
    fi
  fi

  # REQ-036: references type validation (only within references: block)
  if [[ -n "$payload_file" && -f "$payload_file" ]]; then
    local _in_references=false
    while IFS= read -r _ref_line; do
      # Detect start of references block (top-level key)
      if [[ "$_ref_line" =~ ^references: ]]; then
        _in_references=true
        continue
      fi
      # Detect end of references block: any non-empty top-level key that is not a continuation
      if [[ "$_in_references" == "true" && "$_ref_line" =~ ^[^[:space:]] && -n "$_ref_line" ]]; then
        _in_references=false
      fi
      # Only validate type: lines within the references block
      if [[ "$_in_references" == "true" && "$_ref_line" =~ ^[[:space:]]+(-[[:space:]]+)?type:[[:space:]]+(.*) ]]; then
        local _ref_type="${BASH_REMATCH[2]}"
        if [[ ! "$_ref_type" =~ ^(req|pr|bug|doc|file)$ ]]; then
          warn "inbox_write_v2: references type '${_ref_type}' not in enum (req|pr|bug|doc|file)"
        fi
      fi
    done < "$payload_file"
  fi

  {
    echo "---"
    echo "message_id: ${msg_id}"
    echo "type: ${type}"
    echo "from: ${AGENT_ORCHESTRATOR:-pandas}"
    echo "to: ${target}"
    echo "created_at: ${date_str}"
    echo "thread_id: ${thread_id}"
    echo "correlation_id: ${correlation_id}"
    echo "priority: ${priority}"
    case "$type" in
      request)
        echo "action: ${action_or_event}"
        echo "response_required: ${response_required}"
        [[ "$delegation_incomplete" == "true" ]] && echo "delegation_incomplete: true"
        ;;
      response)
        [[ -n "$in_reply_to" ]] && echo "in_reply_to: ${in_reply_to}"
        [[ -n "$status" ]]      && echo "status: ${status}"
        [[ -n "$summary" ]]     && echo "summary: ${summary}"
        ;;
      notification)
        echo "event_type: ${action_or_event}"
        [[ -n "$severity" ]] && echo "severity: ${severity}"
        ;;
    esac
    echo "---"
    [[ -n "$effective_payload" && -f "$effective_payload" ]] && cat "$effective_payload"
  } > "${target_dir}/${filename}"

  # REQ-036: clean up temp payload if created for truncation
  [[ "$effective_payload" != "$payload_file" ]] && rm -f "$effective_payload"

  info "inbox_write_v2 → for-${target}/${filename} [${type}/${action_or_event}]"
}

# _get_fm_field <file> <field>
# 从 YAML frontmatter 提取字段值（与 harness.sh get_field 保持一致）
_get_fm_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# thread_get_or_create <req_id>
# Returns existing thread_id from any inbox trail message for req_id, or creates a new one.
# 幂等：同一消息轨迹状态下多次调用返回相同值（REQ-035）
thread_get_or_create() {
  local req_id="$1"
  local search_dirs=(
    "${INBOX_ROOT}/for-pandas/done"     "${INBOX_ROOT}/for-pandas/failed"
    "${INBOX_ROOT}/for-pandas/claimed"  "${INBOX_ROOT}/for-pandas/pending"
    "${INBOX_ROOT}/for-menglan/done"    "${INBOX_ROOT}/for-menglan/failed"
    "${INBOX_ROOT}/for-menglan/claimed" "${INBOX_ROOT}/for-menglan/pending"
    "${INBOX_ROOT}/for-huahua/done"     "${INBOX_ROOT}/for-huahua/failed"
    "${INBOX_ROOT}/for-huahua/claimed"  "${INBOX_ROOT}/for-huahua/pending"
  )
  local dir f candidate_thread
  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    for f in "${dir}"/*.md; do
      [[ -f "$f" ]] || continue
      grep -q "^req_id: ${req_id}$" "$f" 2>/dev/null || continue
      candidate_thread="$(awk '
        /^---/{delim++; if(delim==2) exit; next}
        delim==1 && /^thread_id:/{sub(/^thread_id:[[:space:]]*/,""); print; exit}
      ' "$f")"
      if [[ -n "$candidate_thread" ]]; then
        echo "$candidate_thread"
        return 0
      fi
    done
  done
  echo "thread_${req_id}_$(date +%s)"
}

# correlation_new <req_id>
# Generates a unique correlation_id using epoch + rand4 for sub-second uniqueness.（REQ-035）
correlation_new() {
  local req_id="$1"
  local rand4; rand4="$(set +o pipefail; tr -dc 'a-z0-9' < /dev/urandom 2>/dev/null | head -c 4)"
  echo "corr_${req_id}_$(date +%s)_${rand4}"
}

# _corr_valid_for_req <req_id> <corr_id>
# Checks whether corr_id matches any outgoing request for req_id in outbox dirs.
# Returns:
#   0 — corr_id found in a matching request (valid)
#   1 — at least one request found for req_id but none carry this corr_id (mismatch)
#   2 — no requests found for req_id at all (skip validation, forward-compat)
# Fixes Bug 1: checks ALL requests for req_id, not just the first.（REQ-035）
_corr_valid_for_req() {
  local req_id="$1" corr_id="$2"
  local search_dirs=(
    "${INBOX_ROOT}/for-menglan/done"    "${INBOX_ROOT}/for-menglan/claimed"
    "${INBOX_ROOT}/for-menglan/pending"
    "${INBOX_ROOT}/for-huahua/done"     "${INBOX_ROOT}/for-huahua/claimed"
    "${INBOX_ROOT}/for-huahua/pending"
  )
  local found_any=false dir f msg_type candidate_corr
  for dir in "${search_dirs[@]}"; do
    [[ -d "$dir" ]] || continue
    for f in "${dir}"/*.md; do
      [[ -f "$f" ]] || continue
      msg_type="$(awk '
        /^---/{delim++; if(delim==2) exit; next}
        delim==1 && /^type:/{sub(/^type:[[:space:]]*/,""); print; exit}
      ' "$f")"
      [[ "$msg_type" == "request" ]] || continue
      grep -q "^req_id: ${req_id}$" "$f" 2>/dev/null || continue
      found_any=true
      candidate_corr="$(awk '
        /^---/{delim++; if(delim==2) exit; next}
        delim==1 && /^correlation_id:/{sub(/^correlation_id:[[:space:]]*/,""); print; exit}
      ' "$f")"
      [[ "$candidate_corr" == "$corr_id" ]] && return 0  # exact match found
    done
  done
  $found_any && return 1  # requests exist but none carry this corr_id
  return 2                # no requests found — skip validation
}

# _dispatch_msg <msg_file> — 路由并处理单条消息，不做文件删除，返回 0/1
# 供 inbox_read_pandas() 在 claim 循环和 flat compat 路径中复用
_dispatch_msg() {
  local msg_file="$1"

  local msg_type
  msg_type="$(_get_fm_field "$msg_file" "type")"

  if [[ -z "$msg_type" ]]; then
    warn "消息缺少 type 字段，跳过: $(basename "$msg_file")"
    return 1
  fi

  info "处理消息: type=${msg_type} file=$(basename "$msg_file")"

  # ── 新格式路由（ATM Envelope）────────────────────────────────────────────
  case "$msg_type" in
    request)
      local action_val; action_val="$(_get_fm_field "$msg_file" "action")"
      local req_id; req_id="$(_get_fm_field "$msg_file" "req_id")"
      local blocking_reason; blocking_reason="$(_get_fm_field "$msg_file" "blocking_reason")"
      info "ATM request: action=${action_val} req_id=${req_id}"
      case "$action_val" in
        # implement は Pandas→Menglan 方向のみ。Pandas inbox で受信した場合は方向違い
        implement)
          warn "ATM request action=implement received in Pandas inbox — wrong direction (should be Pandas→Menglan). Dropping."
          ;;
        tc_design|review|code_review|bugfix|fix_review|escalate|clarify)
          warn "ATM request action=${action_val} — 暂无专用 handler，忽略"
          ;;
        decision_required|major_decision_needed)
          _handle_major_decision "$req_id" "$blocking_reason"
          ;;
        *)
          warn "未知 ATM request action: ${action_val}"
          ;;
      esac
      ;;
    response)
      local req_id; req_id="$(_get_fm_field "$msg_file" "req_id")"
      # ── REQ-035: correlation_id 校验 ──────────────────────────────────
      local resp_corr; resp_corr="$(awk '
        /^---/{delim++; if(delim==2) exit; next}
        delim==1 && /^correlation_id:/{sub(/^correlation_id:[[:space:]]*/,""); print; exit}
      ' "$msg_file")"
      # Fixes Bug 2: only validate when response carries a correlation_id.
      # Responders that omit it (e.g. Huahua legacy format) are allowed through.
      if [[ -n "$resp_corr" ]]; then
        _corr_valid_for_req "$req_id" "$resp_corr"
        local corr_rc=$?
        if [[ $corr_rc -eq 1 ]]; then
          warn "correlation_id 不匹配: response=${resp_corr} req_id=${req_id}"
          return 1
        fi
        # corr_rc=0 (matched) or corr_rc=2 (no requests found) — proceed normally
      fi
      # ── END REQ-035 ────────────────────────────────────────────────────
      local pr_number; pr_number="$(_get_fm_field "$msg_file" "pr_number")"
      local summary; summary="$(_get_fm_field "$msg_file" "summary")"
      local status; status="$(_get_fm_field "$msg_file" "status")"
      local blocking_reason; blocking_reason="$(_get_fm_field "$msg_file" "blocking_reason")"
      local iteration; iteration="$(_get_fm_field "$msg_file" "iteration")"
      # legacy_type: 由 inbox_write() wrapper 写入 payload，区分 tc_complete / dev_complete
      local legacy_type; legacy_type="$(_get_fm_field "$msg_file" "legacy_type")"
      info "ATM response: req_id=${req_id} status=${status} legacy_type=${legacy_type}"
      case "$legacy_type" in
        tc_complete)
          _handle_tc_complete "$req_id" "$pr_number" "${status:-success}" "$blocking_reason" "$iteration"
          ;;
        review_complete)
          # 阶段 5（Code Review）完成信号 — 与 dev_complete（阶段 2）语义独立
          _handle_review_complete "$req_id" "$pr_number" "$summary" "${status:-success}" "$blocking_reason"
          ;;
        review_blocked)
          warn "ATM response review_blocked for ${req_id}: ${blocking_reason}"
          ;;
        dev_complete|"")
          # dev_complete 或未知 legacy_type → 向后兼容路径
          _handle_dev_complete "$req_id" "$pr_number" "$summary" "${status:-success}" "$blocking_reason"
          ;;
        *)
          _handle_dev_complete "$req_id" "$pr_number" "$summary" "${status:-success}" "$blocking_reason"
          ;;
      esac
      ;;
    notification)
      local severity_val; severity_val="$(_get_fm_field "$msg_file" "severity")"
      local event_val; event_val="$(_get_fm_field "$msg_file" "event_type")"
      local req_id; req_id="$(_get_fm_field "$msg_file" "req_id")"
      local blocking_reason; blocking_reason="$(_get_fm_field "$msg_file" "blocking_reason")"
      info "ATM notification: event=${event_val} severity=${severity_val}"
      if [[ "$severity_val" == "action-required" ]]; then
        tg_notify "⚠️ [open-workhorse] ${event_val}: $(basename "$msg_file")" || true
      fi
      # decision_required event → escalate
      if [[ "$event_val" == "decision_required" ]]; then
        _handle_major_decision "$req_id" "$blocking_reason"
      fi
      ;;
    # ── 旧格式路由（legacy）──────────────────────────────────────────────────
    dev_complete|review_complete|tc_complete|major_decision_needed|review_blocked|implement|tc_design|review|code_review|bugfix|fix_review|escalate|clarify)
      _inbox_read_legacy "$msg_file" "$msg_type"
      ;;
    *)
      warn "未知消息类型: ${msg_type}（文件: $(basename "$msg_file")）"
      ;;
  esac
  return 0
}

# inbox_read_pandas — 处理 inbox/for-pandas/ 中所有消息（REQ-021, REQ-023, REQ-033, REQ-034）
# 支持新格式（ATM Envelope, type=request|response|notification）和旧格式双路由
# REQ-034: 先处理 pending/（原子 claim → claimed → done/failed），再处理扁平目录（compat）
inbox_read_pandas() {
  local inbox_dir="${INBOX_ROOT}/for-pandas"
  [[ -d "$inbox_dir" ]] || { info "inbox/for-pandas/ 不存在，跳过"; return 0; }

  local count=0

  # ── A. 新格式：pending/ → claimed → done/failed（原子 claim）────────────
  local pending_dir="${inbox_dir}/pending"
  local claimed_dir="${inbox_dir}/claimed"
  local done_dir="${inbox_dir}/done"
  local failed_dir="${inbox_dir}/failed"

  if [[ -d "$pending_dir" ]]; then
    for msg_file in "${pending_dir}"/*.md; do
      [[ -f "$msg_file" ]] || continue
      count=$(( count + 1 ))
      local basename; basename="$(basename "$msg_file")"
      local claimed_file="${claimed_dir}/${basename}"

      # 原子 claim：mv 失败时区分竞争（源文件消失）和真实错误
      if ! mv "$msg_file" "$claimed_file" 2>/dev/null; then
        if [[ ! -f "$msg_file" ]]; then
          info "Claim 竞争，跳过: ${basename}"
        else
          err "Claim mv 失败（非竞争错误），跳过: ${basename}"
        fi
        continue
      fi

      if _dispatch_msg "$claimed_file"; then
        mv "$claimed_file" "${done_dir}/${basename}"
        info "done: ${basename}"
      else
        mv "$claimed_file" "${failed_dir}/${basename}" 2>/dev/null || true
        printf '\nERROR: handler failed — %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
          >> "${failed_dir}/${basename}"
        err "failed: ${basename}"
      fi
    done
  fi

  # ── B. 旧格式：扁平目录（向后兼容）──────────────────────────────────────
  for msg_file in "${inbox_dir}"/*.md; do
    [[ -f "$msg_file" ]] || continue
    count=$(( count + 1 ))
    if _dispatch_msg "$msg_file"; then
      rm -f "$msg_file"
      info "消费消息: $(basename "$msg_file")"
    else
      rm -f "$msg_file"
      info "消费消息（dispatch失败）: $(basename "$msg_file")"
    fi
  done

  if [[ $count -eq 0 ]]; then info "inbox/for-pandas/ 为空，无消息"; fi
}

# _inbox_read_legacy — 旧格式消息路由（type 字段为旧枚举值）
_inbox_read_legacy() {
  local msg_file="$1"
  local type="$2"

  local req_id pr_number summary status blocking_reason iteration
  req_id="$(_get_fm_field "$msg_file" "req_id")"
  pr_number="$(_get_fm_field "$msg_file" "pr_number")"
  summary="$(_get_fm_field "$msg_file" "summary")"
  status="$(_get_fm_field "$msg_file" "status")"
  blocking_reason="$(_get_fm_field "$msg_file" "blocking_reason")"
  iteration="$(_get_fm_field "$msg_file" "iteration")"

  info "旧格式路由: type=${type} req_id=${req_id} status=${status}"

  case "$type" in
    dev_complete)
      _handle_dev_complete "$req_id" "$pr_number" "$summary" "$status" "$blocking_reason"
      ;;
    review_complete)
      _handle_review_complete "$req_id" "$pr_number" "$summary" "$status" "$blocking_reason"
      ;;
    tc_complete)
      _handle_tc_complete "$req_id" "$pr_number" "$status" "$blocking_reason" "$iteration"
      ;;
    major_decision_needed)
      _handle_major_decision "$req_id" "$blocking_reason"
      ;;
    review_blocked)
      warn "review_blocked for ${req_id}: ${blocking_reason}"
      ;;
    *)
      warn "旧格式未知消息类型: ${type}（文件: $(basename "$msg_file")）"
      ;;
  esac
}

# ── 消息处理器 ────────────────────────────────────────────────────────────────

_handle_dev_complete() {
  local req_id="$1" pr_number="$2" summary="$3" status="$4" blocking_reason="$5"
  # ATM protocol uses "completed"; legacy uses "success" — accept both
  if [[ "$status" == "success" || "$status" == "completed" ]]; then
    info "dev_complete(success): ${req_id} PR #${pr_number} — 发送 PR 合并通知"
    local repo
    repo="${GITHUB_REPO:-$(git remote get-url origin 2>/dev/null | sed 's|.*github\.com[:/]||; s|\.git$||' || true)}"
    local pr_url
    if [[ -n "$repo" && -n "$pr_number" ]]; then
      pr_url="https://github.com/${repo}/pull/${pr_number}"
    else
      pr_url="${pr_number:-unknown}"
    fi
    tg_pr_ready "${pr_url}" "${summary}" || \
      warn "tg_pr_ready 调用失败（Telegram 未配置？）"
  else
    warn "dev_complete(blocked): ${req_id}: ${blocking_reason}"
    tg_notify "⚠️ [${req_id}] dev blocked: ${blocking_reason}" || true
  fi
}

# _handle_review_complete — 阶段 5（Code Review）完成信号
# 语义独立于 dev_complete（阶段 2 实现完成），避免把"审核结果"误解为"开发结果"
_handle_review_complete() {
  local req_id="$1" pr_number="$2" summary="$3" status="$4" blocking_reason="$5"
  # ATM protocol uses "completed"; legacy uses "success" — accept both
  if [[ "$status" == "success" || "$status" == "completed" ]]; then
    info "review_complete(approved): ${req_id} PR #${pr_number} — code review 通过，发送 PR merge-ready 通知"
    local repo
    repo="${GITHUB_REPO:-$(git remote get-url origin 2>/dev/null | sed 's|.*github\.com[:/]||; s|\.git$||' || true)}"
    local pr_url
    if [[ -n "$repo" && -n "$pr_number" ]]; then
      pr_url="https://github.com/${repo}/pull/${pr_number}"
    else
      pr_url="${pr_number:-unknown}"
    fi
    if ! tg_pr_ready "${pr_url}" "${summary}"; then
      warn "tg_pr_ready 调用失败（Telegram 未配置？）— 写入 merge-ready-queue"
      local queue="${REPO_ROOT}/runtime/merge-ready-queue.txt"
      mkdir -p "$(dirname "$queue")" 2>/dev/null || true
      echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) ${req_id} PR #${pr_number} ${pr_url}" >> "$queue" \
        || warn "merge-ready-queue 写入失败（${queue}）"
    fi
  else
    warn "review_complete(rejected): ${req_id}: ${blocking_reason}"
    tg_notify "⚠️ [${req_id}] review rejected/blocked: ${blocking_reason}" || true
  fi
}

_handle_tc_complete() {
  local req_id="$1" pr_number="$2" status="$3" blocking_reason="$4" iteration="${5:-0}"
  local iter_num
  iter_num="$(echo "$iteration" | grep -oE '[0-9]+' || echo "0")"
  iter_num="${iter_num:-0}"

  # ATM protocol uses "completed"; legacy uses "success" — accept both
  if [[ "$status" == "success" || "$status" == "completed" ]]; then
    info "tc_complete(success): ${req_id} — 路由 implement 到 Menglan"
    local req_body=""
    local _req_f="tasks/features/${req_id}.md"
    [[ -f "$_req_f" ]] && req_body="$(cat "$_req_f")"
    inbox_write "menglan" "implement" "$req_id" "实现 ${req_id}（TC 已通过 review）" \
      "" "success" "" "" "$req_body"
  elif [[ $iter_num -lt 2 ]]; then
    local next_iter=$(( iter_num + 1 ))
    info "tc_complete(blocked) iter=${next_iter}: ${req_id} — 路由修复请求到 Huahua"
    inbox_write "huahua" "tc_design" "$req_id" \
      "修复 TC PR #${pr_number}（${blocking_reason}）" \
      "$pr_number" "blocked" "$blocking_reason" "$next_iter"
  else
    warn "tc_complete(blocked) iter=${iter_num} ≥ 2: ${req_id} — 升级决策"
    tg_decision "TC 设计循环超过 2 轮仍有阻塞问题 (${req_id})：${blocking_reason}。继续迭代？" \
      "Continue" "Escalate" || warn "tg_decision 调用失败"
  fi
}

_handle_major_decision() {
  local req_id="$1" blocking_reason="$2"
  warn "major_decision_needed: ${req_id}: ${blocking_reason}"

  # REQ-025: TRIGGER-002 和 TRIGGER-003 检测
  detect_major_decision_from_inbox "major_decision_needed" "$req_id" "$blocking_reason" || return 0

  # 默认处理（未匹配到特定 trigger）
  tg_decision "${req_id} 需要决策：${blocking_reason}" "Proceed" "Hold" || \
    warn "tg_decision 调用失败（Telegram 未配置？）"
}

# ── REQ-025: 重大决策检测 ─────────────────────────────────────────────────────

# detect_major_decision <req_file>
# 扫描 REQ 文件检测 TRIGGER-001（外部凭证依赖）
# 返回值: 0=无触发, 1=有触发（已调用 tg_decision）
detect_major_decision() {
  local req_file="$1"
  [[ -f "$req_file" ]] || return 0

  local req_id
  req_id="$(_get_fm_field "$req_file" "req_id")"

  # TRIGGER-001: REQ body 含 API_KEY/SECRET/TOKEN/credential，但 .env.example 无对应变量
  local suspects
  suspects="$(grep -iEo 'API_KEY[A-Z_]*|SECRET[A-Z_]*|TOKEN[A-Z_]*|CREDENTIALS?' "$req_file" 2>/dev/null | \
    sort -u || true)"

  if [[ -n "$suspects" ]]; then
    local missing_vars=()
    while IFS= read -r candidate; do
      [[ -z "$candidate" ]] && continue
      if ! grep -qF "$candidate" "$REPO_ROOT/.env.example" 2>/dev/null; then
        missing_vars+=("$candidate")
      fi
    done <<< "$suspects"

    if [[ ${#missing_vars[@]} -gt 0 ]]; then
      local vars_str
      vars_str="$(printf '%s, ' "${missing_vars[@]}" | sed 's/, $//')"
      warn "TRIGGER-001: ${req_id} 引用了外部凭证 (${vars_str}) 但 .env.example 中无对应条目"
      tg_decision \
        "${req_id} 需要外部凭证 (${vars_str})，但 .env.example 中无对应变量。现在添加到 .env.example？" \
        "Yes" "Defer" || warn "tg_decision 调用失败"
      return 1
    fi
  fi

  return 0
}

# detect_major_decision_from_inbox — 处理 inbox 消息中的 TRIGGER-002/003
# 返回值: 0=未匹配特定 trigger（继续默认处理），1=已处理（已调用 tg_decision）
detect_major_decision_from_inbox() {
  local type="$1" req_id="$2" blocking_reason="$3"
  [[ "$type" == "major_decision_needed" ]] || return 0

  # TRIGGER-002: depends_on 阻塞
  if echo "$blocking_reason" | grep -qi "depends_on"; then
    warn "TRIGGER-002: ${req_id}: ${blocking_reason}"
    tg_decision \
      "${req_id} 被依赖项阻塞：${blocking_reason}。优先处理该依赖项？" \
      "Yes" "Descope" || warn "tg_decision 调用失败"
    return 1
  fi

  # TRIGGER-003: 范围扩展
  if echo "$blocking_reason" | grep -qi "outside REQ boundary\|changes outside"; then
    warn "TRIGGER-003: ${req_id}: 范围扩展 — ${blocking_reason}"
    tg_decision \
      "${req_id} 实现范围超出规格：${blocking_reason}。批准范围扩展？" \
      "Approve" "Constrain" || warn "tg_decision 调用失败"
    return 1
  fi

  return 0
}

# ── REQ-024: Telegram 指令处理 ────────────────────────────────────────────────

# handle_telegram_commands — 处理来自 Daniel 的 Telegram 文本指令
handle_telegram_commands() {
  local commands
  commands="$(tg_poll_commands 2>/dev/null || true)"
  [[ -z "$commands" ]] && return 0

  while IFS= read -r cmd; do
    [[ -z "$cmd" ]] && continue
    info "Telegram 指令: ${cmd}"

    local cmd_lc
    cmd_lc="$(echo "$cmd" | tr '[:upper:]' '[:lower:]')"
    if [[ "$cmd" =~ ^[Ss][Tt][Aa][Rr][Tt][[:space:]]+([Rr][Ee][Qq]-[0-9]+)$ ]]; then
      local target_req="${BASH_REMATCH[1]}"
      target_req="$(echo "$target_req" | tr '[:lower:]' '[:upper:]')"
      info "start 指令: 立即认领 ${target_req}"
      auto_claim_specific "$target_req"
    elif [[ "$cmd_lc" == "status" ]]; then
      _send_status_report
    elif [[ "$cmd_lc" == "hold" ]]; then
      touch "$HOLD_FLAG"
      info "hold: 已暂停 auto-dispatch（${HOLD_FLAG}）"
      tg_notify "⏸️ Pandas auto-dispatch 已暂停（hold）" || true
    elif [[ "$cmd_lc" == "resume" ]]; then
      rm -f "$HOLD_FLAG"
      info "resume: 已恢复 auto-dispatch"
      tg_notify "▶️ Pandas auto-dispatch 已恢复（resume）" || true
    else
      warn "未知 Telegram 指令: ${cmd}（已忽略）"
    fi
  done <<< "$commands"
}

_send_status_report() {
  local msg
  msg="<b>[open-workhorse] Pandas 状态报告</b>"$'\n'

  local in_progress_tasks=()
  for f in tasks/features/REQ-*.md; do
    [[ -f "$f" ]] || continue
    local s o
    s="$(_get_fm_field "$f" "status")"
    o="$(_get_fm_field "$f" "owner")"
    if [[ "$s" == "in_progress" ]]; then
      in_progress_tasks+=("$(basename "$f" .md) (${o})")
    fi
  done

  if [[ ${#in_progress_tasks[@]} -gt 0 ]]; then
    msg+=$'\n'"<b>进行中任务：</b>"$'\n'
    for t in "${in_progress_tasks[@]}"; do
      msg+="• ${t}"$'\n'
    done
  else
    msg+=$'\n'"无进行中任务"$'\n'
  fi

  local hold_status="active"
  [[ -f "$HOLD_FLAG" ]] && hold_status="paused (hold)"
  msg+=$'\n'"状态：${hold_status}"
  msg+=$'\n'"时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  tg_notify "$msg" || warn "tg_notify 发送失败"
}

# ── BUG-004: review_ready → req_review claim ─────────────────────────────────

# claim_review_ready — 扫描 review_ready 状态 REQ，原子转换为 req_review 并写 Huahua inbox
# 必须在 auto_claim 之前调用，防止 review_ready REQ 被误认为不可认领而永久跳过（BUG-004）
claim_review_ready() {
  [[ -f "$HOLD_FLAG" ]] && { info "hold 模式，跳过 claim_review_ready"; return 0; }

  for f in tasks/features/REQ-*.md; do
    [[ -f "$f" ]] || continue

    local status owner
    status="$(_get_fm_field "$f" "status")"
    owner="$(_get_fm_field "$f" "owner")"

    [[ "$status" == "review_ready" && "$owner" == "unassigned" ]] || continue

    local req_id title
    req_id="$(_get_fm_field "$f" "req_id")"
    title="$(_get_fm_field "$f" "title")"

    # 原子更新 frontmatter — mkdir 作原子锁（POSIX portable，无 flock 依赖）
    # mkdir 在本地文件系统上是原子操作：只有一个并发 heartbeat 能成功创建锁目录。
    # Stale lock recovery: remove locks older than _CLAIM_LOCK_STALE_S seconds
    # (default 120 — 2× heartbeat interval). Falls back to epoch (always-stale)
    # if stat is unavailable. Set _CLAIM_LOCK_STALE_S=0 in tests to force cleanup.
    local _lockdir="${f}.lock"
    if [[ -d "$_lockdir" ]]; then
      local _stale_s="${_CLAIM_LOCK_STALE_S:-120}"
      local _lock_mtime _lock_age
      _lock_mtime=$(stat -c %Y "$_lockdir" 2>/dev/null \
                 || stat -f %m "$_lockdir" 2>/dev/null \
                 || echo 0)
      _lock_age=$(( $(date +%s) - _lock_mtime ))
      if (( _lock_age >= _stale_s )); then
        warn "claim_review_ready: 清理过期锁 ${_lockdir}（age=${_lock_age}s）"
        rmdir "$_lockdir" 2>/dev/null || true
      fi
    fi
    if ! mkdir "$_lockdir" 2>/dev/null; then
      warn "claim_review_ready: 竞争失败（锁目录已存在）${f}，跳过"
      continue
    fi
    sed -i.bak \
      -e "s/^status: review_ready/status: req_review/" \
      -e "s/^owner: unassigned/owner: huahua/" \
      "$f"
    rm -f "${f}.bak"
    rmdir "$_lockdir"

    ok "claim_review_ready: ${req_id} → req_review (owner=huahua)"

    # 写 Huahua inbox 需求评审请求
    local req_body=""
    [[ -f "$f" ]] && req_body="$(cat "$f")"
    inbox_write "huahua" "req_review" "$req_id" \
      "需求评审请求：${title}" "" "" "" "" "$req_body"
  done
}

# ── REQ-022: Auto-claim ───────────────────────────────────────────────────────

# get_priority_rank <priority_str>
# 返回数值权重（数字越小，优先级越高）
get_priority_rank() {
  case "$1" in
    P0) echo 0 ;;
    P1) echo 1 ;;
    P2) echo 2 ;;
    P3) echo 3 ;;
    *)  echo 9 ;;
  esac
}

# auto_claim — 扫描 tasks/features/ 找最高优先级未认领任务并认领
auto_claim() {
  [[ -f "$HOLD_FLAG" ]] && { info "hold 模式，跳过 auto-claim"; return 0; }

  local best_file="" best_rank=99 best_status_tier=99

  for f in tasks/features/REQ-*.md; do
    [[ -f "$f" ]] || continue

    local status owner tc_policy priority tc_exempt_reason
    status="$(_get_fm_field "$f" "status")"
    owner="$(_get_fm_field "$f" "owner")"
    tc_policy="$(_get_fm_field "$f" "tc_policy")"
    priority="$(_get_fm_field "$f" "priority")"
    tc_exempt_reason="$(_get_fm_field "$f" "tc_exempt_reason")"

    # Umbrella REQ 不可认领（仅追踪子 REQ 进度，无实现任务）
    [[ "$tc_exempt_reason" == *"Umbrella"* ]] && continue

    # 过滤可认领状态（按 harness 标准）
    # test_designed は Huahua→Menglan 直通路径处理（tc_complete 信号触发），Pandas 不扫描认领
    local claimable=false status_tier=99
    if [[ "$status" == "ready" && "$owner" == "unassigned" && \
          ( "$tc_policy" == "optional" || "$tc_policy" == "exempt" ) ]]; then
      claimable=true; status_tier=1
    fi
    $claimable || continue

    # 检查 depends_on 是否全部 done
    local depends_raw
    depends_raw="$(awk -F': ' '/^depends_on:/{for(i=2;i<=NF;i++) printf $i; print ""}' "$f" | tr -d '[]')"
    if [[ -n "$(echo "$depends_raw" | tr -d ' ')" ]]; then
      local all_done=true
      IFS=',' read -ra deps <<< "$depends_raw"
      for dep in "${deps[@]}"; do
        dep="$(echo "$dep" | tr -d ' ')"
        [[ -z "$dep" ]] && continue
        if [[ ! "$dep" =~ ^(REQ|BUG)-[0-9]+$ ]]; then
          warn "auto_claim: depends_on 中无效 ID '${dep}'（${f}），fail-closed — 跳过此任务"
          all_done=false
          break
        fi
        local dep_status=""
        for search_path in \
          "tasks/features/${dep}.md" \
          "tasks/bugs/${dep}.md" \
          "tasks/archive/done/${dep}.md"; do
          if [[ -f "$search_path" ]]; then
            dep_status="$(_get_fm_field "$search_path" "status")"
            break
          fi
        done
        if [[ "$dep_status" != "done" ]]; then
          all_done=false; break
        fi
      done
      $all_done || continue
    fi

    # TRIGGER-001 检测
    detect_major_decision "$f" || continue

    local rank
    rank="$(get_priority_rank "$priority")"
    # status_tier 越小优先（test_designed > ready），同 tier 内按 priority 排
    if [[ $status_tier -lt $best_status_tier ]] || \
       [[ $status_tier -eq $best_status_tier && $rank -lt $best_rank ]]; then
      best_file="$f"
      best_rank="$rank"
      best_status_tier="$status_tier"
    fi
  done

  if [[ -z "$best_file" ]]; then
    info "无可认领任务"
    return 0
  fi

  local req_id title
  req_id="$(_get_fm_field "$best_file" "req_id")"
  title="$(_get_fm_field "$best_file" "title")"
  info "auto-claim: ${req_id}（priority rank: ${best_rank}）"

  # 认领：更新 owner 和 status（仅适用于 ready+tc_policy=exempt/optional）
  sed -i.bak "s/^owner: unassigned/owner: claude_code/" "$best_file"
  sed -i.bak "s/^status: ready/status: in_progress/" "$best_file"
  rm -f "${best_file}.bak"

  ok "已认领 ${req_id}"

  # 路由：ready+optional/exempt: 跳过 TC 设计，直接 implement
  local req_body=""
  [[ -f "$best_file" ]] && req_body="$(cat "$best_file")"
  inbox_write "menglan" "implement" "$req_id" "实现 ${req_id}（tc_policy=exempt/optional，跳过 TC 设计）" \
    "" "success" "" "" "$req_body"
}

# auto_claim_specific <req_id> — 认领特定 REQ（Telegram start 指令）
auto_claim_specific() {
  local req_id="$1"
  local req_file="tasks/features/${req_id}.md"
  if [[ ! -f "$req_file" ]]; then
    warn "auto_claim_specific: ${req_file} 不存在"
    return 1
  fi

  local owner tc_exempt_reason
  owner="$(_get_fm_field "$req_file" "owner")"
  tc_exempt_reason="$(_get_fm_field "$req_file" "tc_exempt_reason")"

  if [[ "$owner" != "unassigned" ]]; then
    warn "${req_id} 已被 ${owner} 认领，跳过"
    return 0
  fi

  # Umbrella REQ 不可认领（仅追踪子 REQ 进度，无实现任务）
  if [[ "$tc_exempt_reason" == *"Umbrella"* ]]; then
    warn "${req_id} 为 Umbrella REQ，不可认领实现"
    return 0
  fi

  detect_major_decision "$req_file" || return 0

  # Snapshot routing fields BEFORE mutating the file (orig_status must reflect pre-claim state)
  local title tc_policy orig_status
  title="$(_get_fm_field "$req_file" "title")"
  tc_policy="$(_get_fm_field "$req_file" "tc_policy")"
  orig_status="$(_get_fm_field "$req_file" "status")"

  sed -i.bak "s/^owner: unassigned/owner: claude_code/" "$req_file"
  sed -i.bak "s/^status: [a-z_]*/status: in_progress/" "$req_file"
  rm -f "${req_file}.bak"

  ok "Telegram 触发认领: ${req_id}"

  # TC 已完成或无需 TC → 直接路由到 Menglan；否则路由到 Huahua 做 TC 设计
  local req_body=""
  [[ -f "$req_file" ]] && req_body="$(cat "$req_file")"
  if [[ "$orig_status" == "test_designed" || \
        "$tc_policy" == "exempt" || "$tc_policy" == "optional" ]]; then
    inbox_write "menglan" "implement" "$req_id" "实现 ${req_id}（Telegram 触发）：${title}" \
      "" "success" "" "" "$req_body"
  else
    inbox_write "huahua" "tc_design" "$req_id" "TC 设计请求（Telegram 触发）：${title}"
  fi
}

# ── REQ-037: Worktree 自动清理 ───────────────────────────────────────────────

# 每次心跳检查：若 MENGLAN_WORKTREE_ROOT 已挂载且对应 REQ 已 done，自动移除 worktree
_auto_worktree_clean() {
  local worktree_path="${MENGLAN_WORKTREE_ROOT:-$HOME/workspace-menglan/open-workhorse}"

  # worktree 未挂载则跳过
  git worktree list | grep -qF "$worktree_path" || return 0

  # 读取 worktree 当前分支
  local current_branch
  current_branch="$(git -C "$worktree_path" branch --show-current 2>/dev/null || true)"
  [[ -z "$current_branch" ]] && return 0

  # 仅处理 feat/REQ-N 格式的分支
  [[ "$current_branch" == feat/* ]] || return 0
  local req_id="${current_branch#feat/}"
  if [[ ! "$req_id" =~ ^REQ-[0-9]+$ ]]; then
    warn "auto_worktree_clean: branch '${current_branch}' req_id='${req_id}' 格式不符，跳过"
    return 0
  fi

  # 检查 REQ 是否已 done（features/ 或 archive/done/）
  local req_status=""
  local search_path
  for search_path in \
    "${REPO_ROOT}/tasks/features/${req_id}.md" \
    "${REPO_ROOT}/tasks/archive/done/${req_id}.md"; do
    if [[ -f "$search_path" ]]; then
      req_status="$(_get_fm_field "$search_path" "status")"
      break
    fi
  done

  if [[ "$req_status" == "done" ]]; then
    info "auto_worktree_clean: ${req_id} status=done，自动移除 worktree ${worktree_path}"
    if git worktree remove --force "$worktree_path"; then
      ok "worktree 已自动移除：${worktree_path}（${req_id} done）"
    else
      warn "worktree 自动移除失败：${worktree_path}"
    fi
  fi
}

# ── REQ-031: Post-merge 归档自动化 ───────────────────────────────────────────

# archive_merged_reqs — 扫描 status:review 的 REQ，检测对应 PR 是否已 merge，
# 若已 merge 则更新 REQ + TC status → done，移至 tasks/archive/done/，commit + tg_notify
# 幂等：若无 status:review 的 REQ，直接返回 0
# 错误处理：gh 调用失败时跳过该 REQ（warn + continue），不中断心跳
archive_merged_reqs() {
  [[ -f "$HOLD_FLAG" ]] && { info "hold 模式，跳过 archive_merged_reqs"; return 0; }

  local archived_any=false

  for req_f in "${REPO_ROOT}/tasks/features/REQ-"*.md; do
    [[ -f "$req_f" ]] || continue

    local req_status pr_number
    req_status="$(_get_fm_field "$req_f" "status")"
    [[ "$req_status" == "review" ]] || continue

    pr_number="$(_get_fm_field "$req_f" "pr_number")"
    if [[ -z "$pr_number" ]]; then
      warn "archive_merged_reqs: $(basename "$req_f") status=review but no pr_number — skipping"
      continue
    fi

    # ── 检测 PR 状态 ──────────────────────────────────────────────────────────
    local gh_out gh_state
    if ! gh_out="$(gh pr view "$pr_number" --json state 2>&1)"; then
      warn "archive_merged_reqs: gh pr view ${pr_number} failed for $(basename "$req_f") — skipping (${gh_out})"
      continue
    fi
    gh_state="$(echo "$gh_out" | grep -o '"state":"[^"]*"' | cut -d'"' -f4 || true)"

    if [[ "$gh_state" != "MERGED" ]]; then
      info "archive_merged_reqs: $(basename "$req_f") PR #${pr_number} state=${gh_state} — not merged, skipping"
      continue
    fi

    local req_id
    req_id="$(_get_fm_field "$req_f" "req_id")"
    info "archive_merged_reqs: ${req_id} PR #${pr_number} MERGED — archiving"

    # ── 更新 REQ frontmatter status → done ───────────────────────────────────
    sed -i.bak "s/^status: review/status: done/" "$req_f"
    rm -f "${req_f}.bak"

    # ── 处理关联 TC ───────────────────────────────────────────────────────────
    local tc_refs_raw
    tc_refs_raw="$(awk -F': ' '/^test_case_ref:/{print $2}' "$req_f" | tr -d '[]')"
    local tc_ids=()
    if [[ -n "$(echo "$tc_refs_raw" | tr -d ' ')" ]]; then
      IFS=',' read -ra tc_ids <<< "$tc_refs_raw"
    fi

    local tc_id
    for tc_id in "${tc_ids[@]}"; do
      tc_id="$(echo "$tc_id" | tr -d ' ')"
      [[ -z "$tc_id" ]] && continue
      local tc_f="${REPO_ROOT}/tasks/test-cases/${tc_id}.md"
      [[ -f "$tc_f" ]] || { warn "archive_merged_reqs: TC file not found: ${tc_f}"; continue; }
      # 更新 TC frontmatter status → done（BUG-005 修复）
      sed -i.bak "s/^status: .*/status: done/" "$tc_f"
      rm -f "${tc_f}.bak"
      mv "$tc_f" "${REPO_ROOT}/tasks/archive/done/${tc_id}.md"
      info "archived TC: ${tc_id}"
    done

    # ── 移动 REQ 文件 ─────────────────────────────────────────────────────────
    mv "$req_f" "${REPO_ROOT}/tasks/archive/done/${req_id}.md"
    info "archived REQ: ${req_id}"

    # ── Commit ────────────────────────────────────────────────────────────────
    # Stage new files in archive/done/ and removed files from features/ + test-cases/
    git -C "$REPO_ROOT" add "${REPO_ROOT}/tasks/archive/done/" 2>/dev/null || true
    git -C "$REPO_ROOT" add -u "${REPO_ROOT}/tasks/features/" 2>/dev/null || true
    git -C "$REPO_ROOT" add -u "${REPO_ROOT}/tasks/test-cases/" 2>/dev/null || true
    git -C "$REPO_ROOT" commit -m "archive(${req_id}): move to tasks/archive/done/" || \
      warn "archive_merged_reqs: git commit failed for ${req_id}"

    # ── Telegram 通知 ──────────────────────────────────────────────────────────
    tg_notify "✅ [open-workhorse] ${req_id} 已归档（PR #${pr_number} merged）" || true

    archived_any=true
  done

  if [[ "$archived_any" == "false" ]]; then
    info "archive_merged_reqs: 无待归档 REQ"
  fi
}

# ── REQ-022: 停滞检测 ─────────────────────────────────────────────────────────

stall_detection() {
  local stale_hours="${DEV_WATCHDOG_STALE_HOURS:-4}"
  local stale_seconds=$(( stale_hours * 3600 ))
  local now
  now="$(date +%s)"
  local session_log="${REPO_ROOT}/.harness_sessions"
  [[ -f "$session_log" ]] || return 0

  declare -A last_seen
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local ts cmd target
    ts="$(echo "$line" | awk '{print $1}')"
    cmd="$(echo "$line" | awk '{print $2}')"
    target="$(echo "$line" | awk '{print $3}')"
    [[ "$cmd" == "implement" || "$cmd" == "bugfix" ]] || continue
    [[ -z "$target" ]] && continue
    last_seen["$target"]="$ts"
  done < "$session_log"

  for target in "${!last_seen[@]}"; do
    local ts="${last_seen[$target]}"
    local ts_seconds
    ts_seconds="$(date -d "$ts" +%s 2>/dev/null || \
                  date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null || echo 0)"
    [[ "$ts_seconds" -eq 0 ]] && continue

    local age=$(( now - ts_seconds ))
    [[ $age -le $stale_seconds ]] && continue

    local task_file=""
    for f in "tasks/features/${target}.md" "tasks/bugs/${target}.md"; do
      [[ -f "$f" ]] && task_file="$f" && break
    done
    [[ -z "$task_file" ]] && continue

    local status_val
    status_val="$(awk -F': ' '/^status:/{print $2; exit}' "$task_file" | tr -d ' ')"
    [[ "$status_val" == "in_progress" ]] || continue

    local age_hours=$(( age / 3600 ))
    warn "${target} 停滞 ${age_hours}h（last activity: ${ts}）"
    tg_notify "⚠️ [open-workhorse] ${target} 停滞 ${age_hours}h（status=in_progress，最后活动 ${ts}）" || true
  done
}

# ── 主入口 ────────────────────────────────────────────────────────────────────

main() {
  info "pandas-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  # 0. 同步远端 main（仅 fetch，不 merge，确保本地缓存最新）
  git -C "$REPO_ROOT" fetch origin main --quiet 2>/dev/null \
    || warn "git fetch origin main 失败，继续使用本地缓存"

  # 1. 初始化 inbox 目录
  inbox_init

  # 2. 处理 inbox 消息（REQ-021, REQ-023）
  inbox_read_pandas

  # 3. 处理 Telegram 指令（REQ-024）
  handle_telegram_commands

  # 3.5. claim review_ready REQs → req_review（BUG-004）
  claim_review_ready

  # 3.6. Post-merge 归档（REQ-031）
  archive_merged_reqs

  # 4. Auto-claim（REQ-022）
  auto_claim

  # 5. 停滞检测（REQ-022）
  stall_detection

  # 6. Worktree 自动清理（REQ-037）
  _auto_worktree_clean

  info "pandas-heartbeat 完成"
}

# Guard: skip main() when script is sourced (for unit tests)
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

main "$@"
