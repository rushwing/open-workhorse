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
    [[ "$line" =~ ^(SHARED_RESOURCES_ROOT) ]] || continue
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

# ── 任务状态回退：blocked/unassigned（防止任务卡死在 in_progress）────────────
_rollback_task() {
  local req_id="$1"
  local task_file=""
  # 查找任务文件（features 或 bugs）
  if [[ -f "$REPO_ROOT/tasks/features/${req_id}.md" ]]; then
    task_file="$REPO_ROOT/tasks/features/${req_id}.md"
  elif [[ -f "$REPO_ROOT/tasks/bugs/${req_id}.md" ]]; then
    task_file="$REPO_ROOT/tasks/bugs/${req_id}.md"
  fi
  if [[ -z "$task_file" ]]; then
    warn "rollback: 找不到任务文件 ${req_id}，跳过回退"
    return 0
  fi
  sed -i \
    -e 's/^status: .*/status: blocked/' \
    -e 's/^owner: .*/owner: unassigned/' \
    "$task_file"
  warn "rollback: ${req_id} → status=blocked, owner=unassigned (${task_file})"
}

# ── Failsafe: 失败通知 Pandas ─────────────────────────────────────────────────
_notify_pandas_failure() {
  local msg_basename="$1" reason="$2" req_id="$3"
  local date_str filename
  date_str="$(date +%Y-%m-%d)"
  filename="${date_str}-menglan-fail-${req_id}-$$-${RANDOM}.md"
  mkdir -p "${INBOX_ROOT}/for-pandas"
  {
    echo "---"
    echo "type: major_decision_needed"
    echo "req_id: ${req_id}"
    echo "summary: menglan-heartbeat 处理失败 — ${msg_basename}"
    echo "status: blocked"
    echo "blocking_reason: ${reason}; task reset to blocked/unassigned — review before re-dispatching"
    echo "---"
  } > "${INBOX_ROOT}/for-pandas/${filename}"
  warn "已写入失败告警 → for-pandas/${filename}"
}

# ── 单条消息处理（在 if 内调用，不触发 set -e 退出）──────────────────────────
_process_message() {
  local msg_file="$1"
  local type req_id summary
  type="$(_get_fm_field "$msg_file" "type")"
  req_id="$(_get_fm_field "$msg_file" "req_id")"
  summary="$(_get_fm_field "$msg_file" "summary")"

  info "处理消息: type=${type} req_id=${req_id}"
  info "summary: ${summary}"

  case "$type" in
    implement)
      # Pandas already claimed the task (owner=claude_code, status=in_progress).
      # FORCE=true bypasses the claim gate. (PANDAS-ORCHESTRATION §2 DEV_ACTIVE)
      info "路由 implement → FORCE=true harness.sh implement ${req_id}"
      FORCE=true bash "$REPO_ROOT/scripts/harness.sh" implement "$req_id"
      ;;
    bugfix)
      info "路由 bugfix → harness.sh bugfix ${req_id}"
      bash "$REPO_ROOT/scripts/harness.sh" bugfix "$req_id"
      ;;
    *)
      warn "未知消息类型: ${type} — 移至 dead-letter"
      return 1
      ;;
  esac
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
main() {
  # 空则秒退（零 token）
  local msg
  msg=$(ls "${INBOX}"/*.md 2>/dev/null | head -1 || true)
  [[ -z "$msg" ]] && exit 0

  info "menglan-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  for msg_file in "${INBOX}"/*.md; do
    [[ -f "$msg_file" ]] || continue
    local req_id
    req_id="$(_get_fm_field "$msg_file" "req_id")"

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

main "$@"
