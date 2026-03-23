#!/usr/bin/env bash
# install-menglan-cron.sh — 安装或更新 menglan-heartbeat cron 任务
#
# 用法:
#   bash scripts/install-menglan-cron.sh          # 安装（默认 5 分钟间隔）
#   bash scripts/install-menglan-cron.sh --remove  # 移除 cron 任务
#   bash scripts/install-menglan-cron.sh --status  # 查看当前配置
#
# .env 配置项:
#   MENGLAN_HEARTBEAT_INTERVAL_MINUTES  — 心跳间隔（分钟，默认 5）
#   MENGLAN_HEARTBEAT_OFFSET_MINUTES    — cron 触发偏移（0–N，默认 0；用于错峰，如 0/2/4）
#                                        约束：0 ≤ offset < interval

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ── 读取配置（--status / --remove 也会用到 CRON_MARKER，但不需要校验值）────────
INTERVAL_MINUTES=5
if [[ -f "$REPO_ROOT/.env" ]]; then
  val="$(grep '^MENGLAN_HEARTBEAT_INTERVAL_MINUTES=' "$REPO_ROOT/.env" 2>/dev/null \
        | cut -d= -f2 | tr -d ' \r' || true)"
  [[ -n "$val" ]] && INTERVAL_MINUTES="$val"
fi
INTERVAL_MINUTES="${MENGLAN_HEARTBEAT_INTERVAL_MINUTES:-$INTERVAL_MINUTES}"

OFFSET_MINUTES=0
if [[ -f "$REPO_ROOT/.env" ]]; then
  val="$(grep '^MENGLAN_HEARTBEAT_OFFSET_MINUTES=' "$REPO_ROOT/.env" 2>/dev/null \
        | cut -d= -f2 | tr -d ' \r' || true)"
  [[ -n "$val" ]] && OFFSET_MINUTES="$val"
fi
OFFSET_MINUTES="${MENGLAN_HEARTBEAT_OFFSET_MINUTES:-$OFFSET_MINUTES}"

CRON_MARKER="# menglan-heartbeat managed by install-menglan-cron.sh"

# ── 子命令（--status / --remove 不依赖参数校验）──────────────────────────────
CMD="${1:-install}"

case "$CMD" in
  --remove)
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab - || true
    echo "menglan-heartbeat cron removed"
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
    echo "用法: bash scripts/install-menglan-cron.sh [--remove|--status]" >&2
    exit 1
    ;;
esac

# ── 以下仅 install 路径执行 ────────────────────────────────────────────────────

# 校验参数
if [[ "$OFFSET_MINUTES" -lt 0 || "$OFFSET_MINUTES" -ge "$INTERVAL_MINUTES" ]]; then
  echo "ERROR: MENGLAN_HEARTBEAT_OFFSET_MINUTES must be 0–$((INTERVAL_MINUTES - 1)), got: ${OFFSET_MINUTES}" >&2
  exit 1
fi

# 构造 cron 表达式
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
  echo "ERROR: MENGLAN_HEARTBEAT_INTERVAL_MINUTES must be 1–60, got: ${INTERVAL_MINUTES}" >&2
  exit 1
fi

CRON_CMD="cd ${REPO_ROOT} && bash scripts/menglan-heartbeat.sh >> ${REPO_ROOT}/runtime/menglan-heartbeat.log 2>&1"

# 安装（幂等：先移除旧条目，再写入新条目）
mkdir -p "$REPO_ROOT/runtime"
# crontab -l exits non-zero when no crontab exists; capture with || true so
# set -e does not abort on a clean first-run machine.
existing_crontab="$(crontab -l 2>/dev/null || true)"
(echo "$existing_crontab" | grep -v "$CRON_MARKER"
 echo "${CRON_EXPR} ${CRON_CMD} ${CRON_MARKER}") | crontab -

echo "menglan-heartbeat cron installed"
echo "  interval : ${INTERVAL_MINUTES} min, offset: ${OFFSET_MINUTES}  (${CRON_EXPR})"
echo "  log      : ${REPO_ROOT}/runtime/menglan-heartbeat.log"
echo ""
echo "验证: bash scripts/install-menglan-cron.sh --status"
