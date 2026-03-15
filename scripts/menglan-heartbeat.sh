#!/usr/bin/env bash
# menglan-heartbeat.sh — Menglan inbox 心跳处理器
#
# 用法:
#   bash scripts/menglan-heartbeat.sh   # 由 cron 每 5 分钟调用
#
# 行为:
#   inbox 为空 → 立即退出（零 token，~0.001s CPU）
#   有消息    → 读取 type/req_id → 调用 harness.sh 处理 → 删除消息文件
#
# 依赖环境变量（.env）:
#   SHARED_RESOURCES_ROOT  — 共享收件箱根目录（默认 ~/shared-resources）
#   REPO_ROOT              — open-workhorse 仓库根目录（自动检测）

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

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

INBOX="${SHARED_RESOURCES_ROOT:-${HOME}/shared-resources}/inbox/for-menglan"

# ── 辅助函数 ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${CYAN}[menglan]${NC} $*"; }
warn() { echo -e "${YELLOW}[menglan]${NC} $*"; }
ok()   { echo -e "${GREEN}[menglan]${NC} $*"; }

_get_fm_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
main() {
  # 空则秒退（零 token）
  msg=$(ls "${INBOX}"/*.md 2>/dev/null | head -1 || true)
  [[ -z "$msg" ]] && exit 0

  info "menglan-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  for msg_file in "${INBOX}"/*.md; do
    [[ -f "$msg_file" ]] || continue

    local type req_id summary
    type="$(_get_fm_field "$msg_file" "type")"
    req_id="$(_get_fm_field "$msg_file" "req_id")"
    summary="$(_get_fm_field "$msg_file" "summary")"

    info "处理消息: type=${type} req_id=${req_id}"
    info "summary: ${summary}"

    case "$type" in
      implement)
        info "路由 implement → harness.sh implement ${req_id}"
        bash "$REPO_ROOT/scripts/harness.sh" implement "$req_id"
        ;;
      bugfix)
        info "路由 bugfix → harness.sh bugfix ${req_id}"
        bash "$REPO_ROOT/scripts/harness.sh" bugfix "$req_id"
        ;;
      *)
        warn "未知消息类型: ${type}（文件: $(basename "$msg_file")）— 已跳过"
        ;;
    esac

    # 消费消息（删除已处理文件）
    rm -f "$msg_file"
    ok "消费消息: $(basename "$msg_file")"
  done

  info "menglan-heartbeat 完成"
}

main "$@"
