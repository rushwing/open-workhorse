#!/usr/bin/env bash
# install-pandas-cron.sh — 安装或更新 pandas-heartbeat cron 任务
#
# 用法:
#   bash scripts/install-pandas-cron.sh          # 读取 .env 里的间隔配置
#   bash scripts/install-pandas-cron.sh --remove  # 移除 cron 任务
#   bash scripts/install-pandas-cron.sh --status  # 查看当前配置
#
# .env 配置项:
#   PANDAS_HEARTBEAT_INTERVAL_MINUTES  — 心跳间隔（分钟，默认 5）
#   PANDAS_HEARTBEAT_OFFSET_MINUTES    — cron 触发偏移（0–N，默认 0；用于错峰，如 0/2/4）

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ── 读取 .env 中的间隔配置 ────────────────────────────────────────────────────
INTERVAL_MINUTES=5
if [[ -f "$REPO_ROOT/.env" ]]; then
  val="$(grep '^PANDAS_HEARTBEAT_INTERVAL_MINUTES=' "$REPO_ROOT/.env" 2>/dev/null \
        | cut -d= -f2 | tr -d ' \r' || true)"
  [[ -n "$val" ]] && INTERVAL_MINUTES="$val"
fi
# 环境变量优先
INTERVAL_MINUTES="${PANDAS_HEARTBEAT_INTERVAL_MINUTES:-$INTERVAL_MINUTES}"

# ── 读取触发偏移配置 ──────────────────────────────────────────────────────────
OFFSET_MINUTES=0
if [[ -f "$REPO_ROOT/.env" ]]; then
  val="$(grep '^PANDAS_HEARTBEAT_OFFSET_MINUTES=' "$REPO_ROOT/.env" 2>/dev/null \
        | cut -d= -f2 | tr -d ' \r' || true)"
  [[ -n "$val" ]] && OFFSET_MINUTES="$val"
fi
OFFSET_MINUTES="${PANDAS_HEARTBEAT_OFFSET_MINUTES:-$OFFSET_MINUTES}"

# ── 构造 cron 表达式 ──────────────────────────────────────────────────────────
if [[ "$INTERVAL_MINUTES" -eq 60 && "$OFFSET_MINUTES" -eq 0 ]]; then
  CRON_EXPR="0 * * * *"
elif [[ "$INTERVAL_MINUTES" -ge 1 && "$INTERVAL_MINUTES" -lt 60 ]]; then
  if [[ "$OFFSET_MINUTES" -eq 0 ]]; then
    CRON_EXPR="*/${INTERVAL_MINUTES} * * * *"
  else
    # 生成带偏移的分钟列表，例如 offset=2 interval=5 → "2,7,12,17,22,27,32,37,42,47,52,57"
    minutes=""
    m="$OFFSET_MINUTES"
    while [[ $m -lt 60 ]]; do
      [[ -n "$minutes" ]] && minutes="${minutes},"
      minutes="${minutes}${m}"
      m=$(( m + INTERVAL_MINUTES ))
    done
    CRON_EXPR="${minutes} * * * *"
  fi
else
  echo "ERROR: PANDAS_HEARTBEAT_INTERVAL_MINUTES must be 1–60, got: ${INTERVAL_MINUTES}" >&2
  exit 1
fi

# Resolve node absolute path at install time so cron (which has a minimal
# PATH and no nvm shims) can find it regardless of how node was installed.
NODE_BIN="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: node not found in PATH — run this script from a shell where node is available" >&2
  exit 1
fi

CRON_CMD="cd ${REPO_ROOT} && APP_COMMAND=pandas-heartbeat ${NODE_BIN} --env-file-if-exists=.env --import tsx src/index.ts >> ${REPO_ROOT}/runtime/pandas-heartbeat.log 2>&1"
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
# crontab -l exits non-zero when no crontab exists; capture with || true so
# set -e does not abort on a clean first-run machine.
existing_crontab="$(crontab -l 2>/dev/null || true)"
(echo "$existing_crontab" | grep -v "$CRON_MARKER"
 echo "${CRON_EXPR} ${CRON_CMD} ${CRON_MARKER}") | crontab -

echo "pandas-heartbeat cron installed"
echo "  interval : ${INTERVAL_MINUTES} min, offset: ${OFFSET_MINUTES}  (${CRON_EXPR})"
echo "  log      : ${REPO_ROOT}/runtime/pandas-heartbeat.log"
echo ""
echo "验证: bash scripts/install-pandas-cron.sh --status"
