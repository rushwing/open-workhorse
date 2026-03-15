#!/usr/bin/env bash
# install-pandas-cron.sh — 安装或更新 pandas-heartbeat cron 任务
#
# 用法:
#   bash scripts/install-pandas-cron.sh          # 读取 .env 里的间隔配置
#   bash scripts/install-pandas-cron.sh --remove  # 移除 cron 任务
#   bash scripts/install-pandas-cron.sh --status  # 查看当前配置
#
# .env 配置项:
#   PANDAS_HEARTBEAT_INTERVAL_MINUTES  — 心跳间隔（分钟，默认 30）

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ── 读取 .env 中的间隔配置 ────────────────────────────────────────────────────
INTERVAL_MINUTES=30
if [[ -f "$REPO_ROOT/.env" ]]; then
  val="$(grep '^PANDAS_HEARTBEAT_INTERVAL_MINUTES=' "$REPO_ROOT/.env" 2>/dev/null \
        | cut -d= -f2 | tr -d ' \r' || true)"
  [[ -n "$val" ]] && INTERVAL_MINUTES="$val"
fi
# 环境变量优先
INTERVAL_MINUTES="${PANDAS_HEARTBEAT_INTERVAL_MINUTES:-$INTERVAL_MINUTES}"

# ── 构造 cron 表达式 ──────────────────────────────────────────────────────────
if [[ "$INTERVAL_MINUTES" -eq 60 ]]; then
  CRON_EXPR="0 * * * *"
elif [[ "$INTERVAL_MINUTES" -ge 1 && "$INTERVAL_MINUTES" -lt 60 ]]; then
  CRON_EXPR="*/${INTERVAL_MINUTES} * * * *"
else
  echo "ERROR: PANDAS_HEARTBEAT_INTERVAL_MINUTES must be 1–60, got: ${INTERVAL_MINUTES}" >&2
  exit 1
fi

CRON_CMD="cd ${REPO_ROOT} && APP_COMMAND=pandas-heartbeat node --env-file-if-exists=.env --import tsx src/index.ts >> ${REPO_ROOT}/runtime/pandas-heartbeat.log 2>&1"
CRON_MARKER="# pandas-heartbeat managed by install-pandas-cron.sh"

# ── 子命令 ────────────────────────────────────────────────────────────────────
CMD="${1:-install}"

case "$CMD" in
  --remove)
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab - || true
    echo "pandas-heartbeat cron removed"
    exit 0
    ;;
  --status)
    entry="$(crontab -l 2>/dev/null | grep "$CRON_MARKER" || true)"
    if [[ -n "$entry" ]]; then
      echo "installed: $entry"
    else
      echo "not installed"
    fi
    exit 0
    ;;
  install|"")
    ;;
  *)
    echo "用法: bash scripts/install-pandas-cron.sh [--remove|--status]" >&2
    exit 1
    ;;
esac

# ── 安装（幂等：先移除旧条目，再写入新条目）──────────────────────────────────
(crontab -l 2>/dev/null | grep -v "$CRON_MARKER"
 echo "${CRON_EXPR} ${CRON_CMD} ${CRON_MARKER}") | crontab -

echo "pandas-heartbeat cron installed"
echo "  interval : ${INTERVAL_MINUTES} min  (${CRON_EXPR})"
echo "  log      : ${REPO_ROOT}/runtime/pandas-heartbeat.log"
echo ""
echo "验证: bash scripts/install-pandas-cron.sh --status"
