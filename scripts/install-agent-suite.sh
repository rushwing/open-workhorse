#!/usr/bin/env bash
# install-agent-suite.sh — 一键安装/移除 Pandas AI Agent Teams 的所有 cron 任务
#
# 用法:
#   bash scripts/install-agent-suite.sh          # 安装三个 agent 的 heartbeat cron
#   bash scripts/install-agent-suite.sh --remove  # 移除三个 agent 的 heartbeat cron
#   bash scripts/install-agent-suite.sh --status  # 查看当前 cron 配置
#
# 安装后默认心跳间隔（可通过 .env 或环境变量覆盖）:
#   Pandas  — PANDAS_HEARTBEAT_INTERVAL_MINUTES=5
#   Menglan — MENGLAN_HEARTBEAT_INTERVAL_MINUTES=5
#   Huahua  — HUAHUA_HEARTBEAT_INTERVAL_MINUTES=5
#
# 建议在 .env 中设置 HEARTBEAT_OFFSET 错开触发时间，避免三个 agent 同时唤醒：
#   PANDAS_HEARTBEAT_OFFSET_MINUTES=0    # :00, :05, :10...
#   MENGLAN_HEARTBEAT_OFFSET_MINUTES=2   # :02, :07, :12...
#   HUAHUA_HEARTBEAT_OFFSET_MINUTES=4    # :04, :09, :14...

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SCRIPTS_DIR="${REPO_ROOT}/scripts"

ACTION="${1:-install}"

# ── 传递参数给各子脚本 ────────────────────────────────────────────────────────
install_agent() {
  local name="$1" script="$2"
  echo ""
  echo "── ${name} ──────────────────────────────────"
  bash "${SCRIPTS_DIR}/${script}" "$ACTION" 2>&1 || {
    echo "ERROR: ${script} 失败（exit $?）" >&2
    return 1
  }
}

case "$ACTION" in
  --remove|remove)
    ACTION="--remove"
    echo "=== 移除 Pandas AI Agent Teams cron 任务 ==="
    ;;
  --status|status)
    ACTION="--status"
    echo "=== Pandas AI Agent Teams cron 状态 ==="
    ;;
  *)
    ACTION=""
    echo "=== 安装 Pandas AI Agent Teams cron 任务 ==="
    ;;
esac

install_agent "Pandas  (orchestrator)" "install-pandas-cron.sh"
install_agent "Menglan (implementer)"  "install-menglan-cron.sh"
install_agent "Huahua  (reviewer)"     "install-huahua-cron.sh"

if [[ "$ACTION" == "" ]]; then
  echo ""
  echo "=== 安装完成 — 验证 ==="
  echo "运行 'crontab -l | grep heartbeat' 查看已安装的 cron 条目"
fi
