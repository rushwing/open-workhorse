#!/usr/bin/env bash
# dev-cycle-watchdog.sh — 开发周期停滞检测与 Telegram 告警
#
# 用法:
#   bash scripts/dev-cycle-watchdog.sh          # 正常模式（检测 + 发送告警）
#   DRY_RUN=true bash scripts/dev-cycle-watchdog.sh  # 仅打印，不发 Telegram
#
# 推荐 cron（每 5 小时，Pi 上）：
#   0 */5 * * * cd /path/to/open-workhorse && bash scripts/dev-cycle-watchdog.sh >> logs/watchdog.log 2>&1
#
# 也可通过 APP_COMMAND=dev-watchdog 由 OpenClaw heartbeat 触发（见 src/index.ts）
#
# 依赖环境变量（.env）：
#   DEV_WATCHDOG_STALE_HOURS   — 判定停滞的阈值（默认 4 小时）
#   TELEGRAM_BOT_TOKEN         — Telegram Bot token
#   TELEGRAM_CHAT_ID           — 通知目标 chat ID

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# 加载 .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" =~ ^(TELEGRAM_|DEV_WATCHDOG_) ]] && export "$line" 2>/dev/null || true
  done < "$REPO_ROOT/.env"
fi

STALE_HOURS="${DEV_WATCHDOG_STALE_HOURS:-4}"
DRY_RUN="${DRY_RUN:-false}"
SESSION_LOG=".harness_sessions"
STALE_SECONDS=$(( STALE_HOURS * 3600 ))
NOW="$(date +%s)"

# 引入 Telegram 函数
# shellcheck source=scripts/telegram.sh
source "$REPO_ROOT/scripts/telegram.sh" 2>/dev/null || true

# ── 颜色 ──────────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; YELLOW='\033[1;33m'; NC='\033[0m'
info() { echo -e "${CYAN}[watchdog]${NC} $*"; }
warn() { echo -e "${YELLOW}[watchdog]${NC} $*"; }

info "开始停滞检测（阈值 ${STALE_HOURS}h，dry_run=${DRY_RUN}）..."

stalled_tasks=()
stalled_prs=()

# ── 检测 1：.harness_sessions 中 in_progress 任务是否停滞 ────────────────────

if [[ -f "$SESSION_LOG" ]]; then
  # .harness_sessions 格式：<ISO8601_UTC> <command> <target>
  # 找到 implement/bugfix 行，检查最后活动时间
  declare -A last_seen
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    ts="$(echo "$line" | awk '{print $1}')"
    cmd="$(echo "$line" | awk '{print $2}')"
    target="$(echo "$line" | awk '{print $3}')"
    [[ "$cmd" == "implement" || "$cmd" == "bugfix" ]] || continue
    [[ -z "$target" ]] && continue
    last_seen["$target"]="$ts"
  done < "$SESSION_LOG"

  for target in "${!last_seen[@]}"; do
    ts="${last_seen[$target]}"
    # 解析 ISO8601 UTC 时间戳
    ts_seconds="$(date -d "$ts" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "$ts" +%s 2>/dev/null || echo 0)"
    [[ "$ts_seconds" -eq 0 ]] && continue

    age=$(( NOW - ts_seconds ))
    if [[ $age -gt $STALE_SECONDS ]]; then
      # 检查任务是否仍为 in_progress（未完成）
      task_file=""
      for f in "tasks/features/${target}.md" "tasks/bugs/${target}.md"; do
        [[ -f "$f" ]] && task_file="$f" && break
      done
      if [[ -n "$task_file" ]]; then
        status_val="$(awk -F': ' '/^status:/{print $2; exit}' "$task_file" | tr -d ' ')"
        if [[ "$status_val" == "in_progress" ]]; then
          age_hours=$(( age / 3600 ))
          warn "${target} 停滞 ${age_hours}h（status=in_progress，最后活动 ${ts}）"
          stalled_tasks+=("${target}:${age_hours}h")
        fi
      fi
    fi
  done
fi

# ── 检测 2：开放 PR 无 review 活动 ───────────────────────────────────────────

if command -v gh &>/dev/null; then
  # 获取所有 open PR（跳过 GH CLI update notifier）
  open_prs="$(GH_NO_UPDATE_NOTIFIER=1 gh pr list --state open --json number,title,createdAt,reviewDecision 2>/dev/null || echo '[]')"
  while IFS= read -r pr_json; do
    [[ -z "$pr_json" ]] && continue
    pr_num="$(echo "$pr_json" | grep -o '"number":[0-9]*' | cut -d: -f2)"
    pr_title="$(echo "$pr_json" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"
    created_at="$(echo "$pr_json" | grep -o '"createdAt":"[^"]*"' | cut -d'"' -f4)"
    review_decision="$(echo "$pr_json" | grep -o '"reviewDecision":"[^"]*"' | cut -d'"' -f4 || echo '')"

    [[ -z "$pr_num" ]] && continue

    created_seconds="$(date -d "$created_at" +%s 2>/dev/null || date -j -f '%Y-%m-%dT%H:%M:%SZ' "${created_at%%.*}Z" +%s 2>/dev/null || echo 0)"
    [[ "$created_seconds" -eq 0 ]] && continue

    age=$(( NOW - created_seconds ))
    # 无 review decision 且超过阈值 → 视为停滞
    if [[ $age -gt $STALE_SECONDS && -z "$review_decision" ]]; then
      age_hours=$(( age / 3600 ))
      warn "PR #${pr_num} 「${pr_title}」已开 ${age_hours}h，无 review"
      stalled_prs+=("#${pr_num}:${age_hours}h:${pr_title}")
    fi
  done < <(echo "$open_prs" | grep -o '{[^}]*}' || true)
fi

# ── 汇总与通知 ────────────────────────────────────────────────────────────────

total_stalled=$(( ${#stalled_tasks[@]} + ${#stalled_prs[@]} ))

if [[ $total_stalled -eq 0 ]]; then
  info "无停滞项目，开发循环正常"
  exit 0
fi

# 构建通知消息
msg="<b>[open-workhorse watchdog]</b> 检测到 ${total_stalled} 个停滞项目"$'\n'

if [[ ${#stalled_tasks[@]} -gt 0 ]]; then
  msg+=$'\n''<b>停滞任务：</b>'$'\n'
  for item in "${stalled_tasks[@]}"; do
    task="${item%%:*}"
    age="${item##*:}"
    msg+="• ${task}（停滞 ${age}）— resume: harness.sh implement ${task}"$'\n'
  done
fi

if [[ ${#stalled_prs[@]} -gt 0 ]]; then
  msg+=$'\n''<b>待 review PR：</b>'$'\n'
  for item in "${stalled_prs[@]}"; do
    pr="${item%%:*}"
    rest="${item#*:}"
    age="${rest%%:*}"
    title="${rest#*:}"
    msg+="• PR ${pr}「${title}」（${age} 无 review）"$'\n'
  done
fi

msg+=$'\n'"检测时间：$(date -u +%Y-%m-%dT%H:%M:%SZ)"

info "停滞摘要："
echo "$msg" | sed 's/<[^>]*>//g'

if [[ "$DRY_RUN" == "true" ]]; then
  info "DRY_RUN=true，跳过 Telegram 通知"
  exit 0
fi

# 发送 Telegram 通知
if [[ -z "${TELEGRAM_BOT_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
  warn "TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未配置，跳过通知"
  exit 0
fi

if tg_notify "$msg" 2>/dev/null; then
  info "Telegram 通知已发送"
else
  warn "Telegram 通知发送失败（请检查 BOT_TOKEN / CHAT_ID 配置）"
fi
