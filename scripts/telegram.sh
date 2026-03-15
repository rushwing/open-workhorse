#!/usr/bin/env bash
# telegram.sh — Telegram HITL 通知与决策工具
#
# 用法:
#   source scripts/telegram.sh               # 在其他脚本中引入函数
#   bash scripts/telegram.sh tg_notify "消息"
#   bash scripts/telegram.sh tg_decision "问题" "选项A" "选项B"
#   bash scripts/telegram.sh tg_pr_ready "<pr_url>" "摘要"
#   bash scripts/telegram.sh tg_poll_commands  # 打印未处理的 Daniel 指令
#   bash scripts/telegram.sh test            # 发送测试消息验证配置
#
# 依赖环境变量（在 .env 中配置）：
#   TELEGRAM_BOT_TOKEN  — Telegram Bot API token
#   TELEGRAM_CHAT_ID    — 目标 chat ID（Daniel 的聊天）
#
# 初始配置步骤（Daniel 执行一次）：
#   1. 打开 Telegram，搜索 @BotFather，发送 /newbot，按提示创建 Bot
#   2. 将 Bot API token 填入 .env: TELEGRAM_BOT_TOKEN=xxx
#   3. 向你的 Bot 发送任意一条消息（激活 chat）
#   4. 获取 CHAT_ID：
#      curl "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | jq '.result[0].message.chat.id'
#   5. 将 chat ID 填入 .env: TELEGRAM_CHAT_ID=xxx
#   6. 验证：bash scripts/telegram.sh test

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 加载 .env（如果存在）
if [[ -f "$REPO_ROOT/.env" ]]; then
  # 仅 export 包含 TELEGRAM 或 DEV_WATCHDOG 的行
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" =~ ^(TELEGRAM_|DEV_WATCHDOG_) ]] && export "$line" 2>/dev/null || true
  done < "$REPO_ROOT/.env"
fi

BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${TELEGRAM_CHAT_ID:-}"
TG_API="https://api.telegram.org/bot${BOT_TOKEN}"

# ── 内部工具 ──────────────────────────────────────────────────────────────────

_check_config() {
  if [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]]; then
    echo "[telegram] ERROR: TELEGRAM_BOT_TOKEN 或 TELEGRAM_CHAT_ID 未设置" >&2
    echo "[telegram] 请参考 scripts/telegram.sh 文件头部的配置步骤" >&2
    return 1
  fi
}

_tg_post() {
  local endpoint="$1"
  shift
  curl -s -X POST "${TG_API}/${endpoint}" \
    -H "Content-Type: application/json" \
    -d "$@"
}

# ── 公开函数 ──────────────────────────────────────────────────────────────────

# tg_notify <message>
# 发送纯文本通知，fire-and-forget
tg_notify() {
  local message="${1:-}"
  _check_config || return 1

  local payload
  payload="$(printf '{"chat_id":"%s","text":"%s","parse_mode":"HTML"}' \
    "$CHAT_ID" \
    "$(echo "$message" | sed 's/"/\\"/g; s/$/\\n/' | tr -d '\n' | sed 's/\\n$//')")"

  local result
  result="$(_tg_post sendMessage "$payload")"
  local ok
  ok="$(echo "$result" | grep -o '"ok":true' || true)"
  if [[ -z "$ok" ]]; then
    echo "[telegram] sendMessage failed: $result" >&2
    return 1
  fi
  echo "[telegram] notified: $message"
}

# tg_poll_commands [offset_file]
# 轮询 getUpdates，返回来自 CHAT_ID 的未处理文本消息（每行一条）
# offset 持久化到 offset_file（默认 .pandas_tg_offset）
# 未配置 Telegram 时静默返回（非 fatal）
tg_poll_commands() {
  local offset_file="${1:-${REPO_ROOT}/.pandas_tg_offset}"
  [[ -z "$BOT_TOKEN" || -z "$CHAT_ID" ]] && return 0

  local offset=0
  [[ -f "$offset_file" ]] && offset="$(cat "$offset_file")"

  local updates
  updates="$(curl -s "${TG_API}/getUpdates?offset=${offset}&timeout=0&allowed_updates=%5B%22message%22%5D" 2>/dev/null || echo '{}')"

  local ok
  ok="$(echo "$updates" | grep -o '"ok":true' || true)"
  [[ -z "$ok" ]] && return 0

  # 遍历每条 update，仅输出来自目标 CHAT_ID 的文本消息
  local max_update_id=""
  while IFS= read -r line; do
    local uid chat_id text
    uid="$(echo "$line"   | grep -o '"update_id":[0-9]*' | head -1 | cut -d: -f2 || true)"
    chat_id="$(echo "$line" | grep -oP '"chat":\{"id":\K-?[0-9]+' 2>/dev/null \
               || echo "$line" | grep -o '"id":-\?[0-9]*' | head -1 | cut -d: -f2 || true)"
    text="$(echo "$line" | grep -o '"text":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"

    if [[ -n "$uid" && "$chat_id" == "$CHAT_ID" && -n "$text" ]]; then
      echo "$text"
      max_update_id="$uid"
    fi
  done < <(echo "$updates" | grep -o '"update_id":[0-9]*[^}]*}' || true)

  # 推进 offset，标记已消费
  if [[ -n "$max_update_id" ]]; then
    echo $(( max_update_id + 1 )) > "$offset_file"
  fi
}

# tg_decision <message> <option_a> <option_b>
# 发送带 inline keyboard 的消息，轮询等待 Daniel 的 callback，返回选中的 option (stdout)
# 默认超时 86400 秒（24 小时），每 30 秒 poll 一次（可通过 TG_DECISION_TIMEOUT 覆盖）
tg_decision() {
  local message="${1:-}" option_a="${2:-Yes}" option_b="${3:-No}"
  _check_config || return 1

  local timeout="${TG_DECISION_TIMEOUT:-86400}"
  local poll_interval=30

  # 构建 inline keyboard JSON
  local keyboard
  keyboard="{\"inline_keyboard\":[[{\"text\":\"${option_a}\",\"callback_data\":\"${option_a}\"},{\"text\":\"${option_b}\",\"callback_data\":\"${option_b}\"}]]}"

  local payload
  payload="{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$(echo "$message" | sed 's/"/\\"/g')\",\"parse_mode\":\"HTML\",\"reply_markup\":${keyboard}}"

  local result
  result="$(_tg_post sendMessage "$payload")"
  local ok
  ok="$(echo "$result" | grep -o '"ok":true' || true)"
  if [[ -z "$ok" ]]; then
    echo "[telegram] sendMessage failed: $result" >&2
    return 1
  fi

  local msg_id
  msg_id="$(echo "$result" | grep -o '"message_id":[0-9]*' | head -1 | cut -d: -f2)"

  # 轮询 getUpdates 等待 callback_query，默认最多 86400 秒（24h）
  echo "[telegram] waiting for decision (timeout ${timeout}s, poll every ${poll_interval}s)..." >&2
  local offset=0 elapsed=0 chosen=""
  while [[ $elapsed -lt $timeout ]]; do
    local updates
    updates="$(curl -s "${TG_API}/getUpdates?offset=${offset}&timeout=0&allowed_updates=%5B%22callback_query%22%5D" 2>/dev/null || echo '{}')"
    local callback_msg_id
    callback_msg_id="$(echo "$updates" | grep -o '"message_id":[0-9]*' | head -1 | cut -d: -f2 || true)"

    if [[ "$callback_msg_id" == "$msg_id" ]]; then
      chosen="$(echo "$updates" | grep -o '"data":"[^"]*"' | head -1 | cut -d'"' -f4 || true)"
      # ack callback
      local cb_id
      cb_id="$(echo "$updates" | grep -o '"id":"[0-9]*"' | head -1 | cut -d'"' -f4 || true)"
      curl -s -X POST "${TG_API}/answerCallbackQuery" \
        -H "Content-Type: application/json" \
        -d "{\"callback_query_id\":\"${cb_id}\"}" >/dev/null 2>&1 || true
      break
    fi

    # 更新 offset
    local update_id
    update_id="$(echo "$updates" | grep -o '"update_id":[0-9]*' | tail -1 | cut -d: -f2 || true)"
    [[ -n "$update_id" ]] && offset=$(( update_id + 1 ))

    sleep "$poll_interval"
    elapsed=$(( elapsed + poll_interval ))
  done

  if [[ -z "$chosen" ]]; then
    echo "[telegram] decision timed out after ${timeout}s — re-notifying" >&2
    tg_notify "⚠️ 决策超时（${timeout}s）：$message — 请重新回复" || true
    return 1
  fi

  echo "$chosen"
}

# tg_pr_ready <pr_url> <summary>
# 发送 PR 就绪通知，带 [Merge] [Hold] inline buttons
# 返回：selected option stdout
tg_pr_ready() {
  local pr_url="${1:-}" summary="${2:-}"
  _check_config || return 1

  local message
  message="$(printf '<b>PR Ready to Merge</b>\n%s\n\n%s\n\nAction?' "$pr_url" "$summary")"

  local chosen
  chosen="$(tg_decision "$message" "Merge" "Hold")"
  echo "$chosen"
}

# ── 子命令入口（仅直接执行时运行，source 时跳过）────────────────────────────

[[ "${BASH_SOURCE[0]}" != "$0" ]] && return 0

CMD="${1:-}"

case "$CMD" in
  tg_notify)
    shift
    tg_notify "${1:-test notification from open-workhorse}"
    ;;
  tg_decision)
    shift
    result="$(tg_decision "${1:-Proceed with deployment?}" "${2:-Yes}" "${3:-No}")"
    echo "[telegram] decision result: $result"
    ;;
  tg_pr_ready)
    shift
    result="$(tg_pr_ready "${1:-https://github.com/example/pr/1}" "${2:-PR summary}")"
    echo "[telegram] pr_ready result: $result"
    ;;
  tg_poll_commands)
    shift
    tg_poll_commands "${1:-}"
    ;;
  test)
    tg_notify "open-workhorse Telegram HITL test — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "[telegram] test message sent — check your Telegram"
    ;;
  "")
    echo "用法："
    echo "  bash scripts/telegram.sh tg_notify \"消息\""
    echo "  bash scripts/telegram.sh tg_decision \"问题\" \"选项A\" \"选项B\""
    echo "  bash scripts/telegram.sh tg_pr_ready \"<pr_url>\" \"摘要\""
    echo "  bash scripts/telegram.sh tg_poll_commands  # 打印未处理的 Daniel 指令"
    echo "  bash scripts/telegram.sh test"
    exit 0
    ;;
  *)
    echo "[telegram] unknown command: $CMD" >&2
    exit 1
    ;;
esac
