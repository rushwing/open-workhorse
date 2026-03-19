#!/usr/bin/env bash
# scripts/init-memory.sh — 初始化 Pandas Agent Team 的长期记忆数据库
#
# 用法:
#   bash scripts/init-memory.sh              # 使用默认 workspace root ($HOME)
#   bash scripts/init-memory.sh /opt/agents  # 指定 workspace root
#   bash scripts/init-memory.sh --dry-run    # 预览，不实际写入
#
# 前置条件:
#   - workspace-pandas/memory/ 目录结构已部署
#   - everything_openclaw 已克隆至 ~/workspace-pandas/everything_openclaw
#   - sqlite3 已安装（apt install sqlite3）
#
# 此脚本负责:
#   1. 验证 memory 目录结构已就绪
#   2. 从 schema.sql 初始化 project.db（幂等 — 已存在则跳过）
#   3. 打印"剩余事项"清单

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# REPO_ROOT is not used directly — schema is sourced from everything_openclaw

# ── 参数解析 ────────────────────────────────────────────────────────────────
DRY_RUN=false
WORKSPACE_ROOT="$HOME"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --*) echo "未知选项: $arg" >&2; exit 1 ;;
    *) WORKSPACE_ROOT="$arg" ;;
  esac
done

# ── 路径定义 ────────────────────────────────────────────────────────────────
PANDAS_MEM="$WORKSPACE_ROOT/workspace-pandas/memory"
SCHEMA_SRC="$WORKSPACE_ROOT/workspace-pandas/everything_openclaw/personas/workspace-pandas/memory/long-term/schema.sql"
SCHEMA_DEST="$PANDAS_MEM/long-term/schema.sql"
DB_PATH="${MEMORY_DB_PATH:-$PANDAS_MEM/long-term/project.db}"

# ── 颜色 ─────────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info()   { echo -e "${CYAN}[init-memory]${NC} $*"; }
ok()     { echo -e "${GREEN}[init-memory]${NC} $*"; }
warn()   { echo -e "${YELLOW}[init-memory]${NC} $*"; }
err()    { echo -e "${RED}[init-memory]${NC} $*" >&2; }
header() { echo -e "\n${BOLD}── $* ${NC}"; }

# ── ヘッダー ─────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     open-workhorse — init-memory                 ║"
echo "║     Pandas Agent Team · Long-Term Memory DB      ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
echo "  workspace root : $WORKSPACE_ROOT"
echo "  project.db     : $DB_PATH"
$DRY_RUN && echo -e "  ${YELLOW}mode           : DRY RUN（不写入文件）${NC}"

# ── Step 1: 验证 memory 目录结构 ─────────────────────────────────────────────
header "Step 1: 验证 memory 目录结构"

REQUIRED_DIRS=(
  "$PANDAS_MEM"
  "$PANDAS_MEM/short-term/sessions"
  "$PANDAS_MEM/short-term/candidates"
  "$PANDAS_MEM/projects"
  "$PANDAS_MEM/long-term"
  "$WORKSPACE_ROOT/workspace-huahua/memory"
  "$WORKSPACE_ROOT/workspace-menglan/memory"
)

ALL_OK=true

for dir in "${REQUIRED_DIRS[@]}"; do
  if [[ -d "$dir" ]]; then
    info "  ✓  $dir"
  else
    err "  ✗  $dir (缺失)"
    ALL_OK=false
  fi
done

if ! $ALL_OK; then
  echo ""
  err "目录结构不完整。请先创建所需目录，或参考 docs/SETUP.md"
  exit 1
fi

ok "目录结构验证通过"

# ── Step 2: 同步 schema.sql（始终以 repo 版本为准）────────────────────────────
header "Step 2: 同步 schema.sql"

if [[ ! -f "$SCHEMA_SRC" ]]; then
  err "schema.sql 不存在: $SCHEMA_SRC"
  err "请确认 everything_openclaw 已克隆至 ~/workspace-pandas/everything_openclaw"
  exit 1
fi

# Always sync from the version-controlled source to prevent stale deployed schema.
# Use checksum comparison so we only write when content actually changed.
SCHEMA_NEEDS_UPDATE=true
if [[ -f "$SCHEMA_DEST" ]]; then
  SRC_SUM=$(md5sum "$SCHEMA_SRC" | cut -d' ' -f1)
  DEST_SUM=$(md5sum "$SCHEMA_DEST" | cut -d' ' -f1)
  if [[ "$SRC_SUM" == "$DEST_SUM" ]]; then
    SCHEMA_NEEDS_UPDATE=false
    ok "schema.sql 已是最新（checksum 一致）: $SCHEMA_DEST"
  else
    warn "schema.sql 已过期 — 将从 repo 版本覆盖"
  fi
fi

if $SCHEMA_NEEDS_UPDATE; then
  if $DRY_RUN; then
    info "[dry-run] cp $SCHEMA_SRC → $SCHEMA_DEST"
  else
    cp "$SCHEMA_SRC" "$SCHEMA_DEST"
    ok "schema.sql 已同步 → $SCHEMA_DEST"
  fi
fi

# ── Step 3: 初始化 project.db ─────────────────────────────────────────────────
header "Step 3: 初始化 project.db"

if ! command -v sqlite3 &>/dev/null; then
  warn "sqlite3 未安装 — 跳过 project.db 初始化"
  warn "请安装: apt install sqlite3"
  warn "安装后手动执行: sqlite3 ${DB_PATH} < ${SCHEMA_DEST}"
else
  # Validate schema shape: check required columns and the candidates.status CHECK constraint.
  # Returns 0 (ok) or 1 (drift detected).
  verify_schema_shape() {
    local db="$1"
    local ok_flag=true

    # Required columns per table: "table:col1,col2,..."
    local -a REQUIRED_COLS=(
      "project_facts:id,topic,content,source_agent,created_at"
      "decisions:id,title,decision,rationale,made_by,date"
      "patterns:id,pattern_type,agent,description,example,created_at"
      "candidates:id,source_agent,topic,content,status,proposed_at,reviewed_at"
    )

    for entry in "${REQUIRED_COLS[@]}"; do
      local tbl="${entry%%:*}"
      local cols="${entry##*:}"
      local col_info
      col_info=$(sqlite3 "$db" "PRAGMA table_info(${tbl});" 2>/dev/null || true)
      if [[ -z "$col_info" ]]; then
        warn "  ✗  table missing: $tbl"
        ok_flag=false
        continue
      fi
      IFS=',' read -ra COL_LIST <<< "$cols"
      for col in "${COL_LIST[@]}"; do
        if echo "$col_info" | grep -qw "$col"; then
          info "  ✓  ${tbl}.${col}"
        else
          warn "  ✗  ${tbl}.${col} 缺失"
          ok_flag=false
        fi
      done
    done

    # Verify candidates.status CHECK constraint includes pending/accepted/rejected
    local check_sql
    check_sql=$(sqlite3 "$db" \
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='candidates';" 2>/dev/null || true)
    for val in pending accepted rejected; do
      if echo "$check_sql" | grep -q "'${val}'"; then
        info "  ✓  candidates.status CHECK includes '${val}'"
      else
        warn "  ✗  candidates.status CHECK missing '${val}'"
        ok_flag=false
      fi
    done

    $ok_flag
  }

  if [[ -f "$DB_PATH" ]]; then
    ok "project.db 已存在: $DB_PATH"
    info "验证 schema 结构..."
    if ! verify_schema_shape "$DB_PATH"; then
      warn "schema 结构不符 — 重新应用 schema"
      if $DRY_RUN; then
        info "[dry-run] sqlite3 $DB_PATH < $SCHEMA_DEST"
      else
        sqlite3 "$DB_PATH" < "$SCHEMA_DEST"
        ok "schema 已重新应用"
        verify_schema_shape "$DB_PATH" || { err "schema 重新应用后验证仍失败"; exit 1; }
      fi
    else
      ok "schema 结构验证通过"
    fi
  else
    if $DRY_RUN; then
      info "[dry-run] sqlite3 $DB_PATH < $SCHEMA_DEST"
    else
      sqlite3 "$DB_PATH" < "$SCHEMA_DEST"
      ok "project.db 已创建: $DB_PATH"
      info "验证 schema 结构..."
      verify_schema_shape "$DB_PATH" || { err "新建 DB schema 验证失败"; exit 1; }
      ok "schema 结构验证通过"
    fi
  fi
fi

# ── 剩余事项清单 ─────────────────────────────────────────────────────────────
header "剩余事项"

cat <<'CHECKLIST'
以下配置需在 open-workhorse 部署中完成：

  [ ] RUNBOOK adapter 渲染
        npm run runbook:render
        参考: harness/memory-architecture.md

  [ ] OpenClaw 配置（openclaw.json）
        - channels（Telegram/WhatsApp 等）
        - models（pandas/menglan/huahua）
        - API keys（ANTHROPIC_API_KEY 等）

  [ ] 通知命令绑定（.env）
        TELEGRAM_BOT_TOKEN=
        TELEGRAM_CHAT_ID=
        参考: scripts/telegram.sh

  [ ] Heartbeat & Inbox watcher cron
        npm run harness:status
        参考: scripts/install-pandas-cron.sh

CHECKLIST

echo -e "${GREEN}${BOLD}"
if $DRY_RUN; then
  echo "dry-run 完成 — 未写入任何文件"
else
  echo "init-memory 完成"
fi
echo -e "${NC}"
