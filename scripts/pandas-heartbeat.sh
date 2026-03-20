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
warn()  { echo -e "${YELLOW}[pandas]${NC} $*"; }
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

  # 生成兼容 thread_id / correlation_id（epoch-based）
  local epoch; epoch="$(date +%s)"
  local thread_id="thread_${req_id}_${epoch}"
  local correlation_id="corr_${req_id}_${epoch}"

  # 旧 type → 新 type/action 映射
  # code_review 规范化为 review（Daniel 决策 2026-03-20）
  local new_type action_or_event
  case "$type" in
    implement|tc_design|review|code_review|bugfix|fix_review|escalate|clarify)
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
  filename="${date_str//:/-}__${type}__${AGENT_ORCHESTRATOR:-pandas}_to_${target}__${correlation_id:-notset}.md"
  # REQ-034: write to pending/ sub-directory for atomic claim lifecycle
  target_dir="${INBOX_ROOT}/for-${target}/pending"
  mkdir -p "$target_dir"

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
    [[ -n "$payload_file" && -f "$payload_file" ]] && cat "$payload_file"
  } > "${target_dir}/${filename}"

  info "inbox_write_v2 → for-${target}/${filename} [${type}/${action_or_event}]"
}

# _get_fm_field <file> <field>
# 从 YAML frontmatter 提取字段值（与 harness.sh get_field 保持一致）
_get_fm_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
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
    tg_pr_ready "${pr_url}" "${summary}" || \
      warn "tg_pr_ready 调用失败（Telegram 未配置？）"
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
    local claimable=false status_tier=99
    if [[ "$status" == "test_designed" && "$owner" == "unassigned" ]]; then
      claimable=true; status_tier=0
    elif [[ "$status" == "ready" && "$owner" == "unassigned" && \
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

  # 认领：更新 owner 和 status
  sed -i.bak "s/^owner: unassigned/owner: claude_code/" "$best_file"
  sed -i.bak "s/^status: test_designed/status: in_progress/" "$best_file"
  sed -i.bak "s/^status: ready/status: in_progress/" "$best_file"
  rm -f "${best_file}.bak"

  ok "已认领 ${req_id}"

  # 路由：test_designed (tier=0) 或 ready+optional/exempt (tier=1) 均跳过 TC 设计，直接 implement
  local req_body=""
  [[ -f "$best_file" ]] && req_body="$(cat "$best_file")"
  if [[ $best_status_tier -eq 0 ]]; then
    # status=test_designed: TC 已完成，直接路由到 Menglan 实现
    inbox_write "menglan" "implement" "$req_id" "实现 ${req_id}（TC 已完成 / test_designed）" \
      "" "success" "" "" "$req_body"
  else
    # status=ready, tc_policy=optional/exempt: 跳过 TC，直接路由到 Menglan 实现
    inbox_write "menglan" "implement" "$req_id" "实现 ${req_id}（tc_policy=exempt/optional，跳过 TC 设计）" \
      "" "success" "" "" "$req_body"
  fi
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

  # 1. 初始化 inbox 目录
  inbox_init

  # 2. 处理 inbox 消息（REQ-021, REQ-023）
  inbox_read_pandas

  # 3. 处理 Telegram 指令（REQ-024）
  handle_telegram_commands

  # 4. Auto-claim（REQ-022）
  auto_claim

  # 5. 停滞检测（REQ-022）
  stall_detection

  info "pandas-heartbeat 完成"
}

# Guard: skip main() when script is sourced (for unit tests)
[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

main "$@"
