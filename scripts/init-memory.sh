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

# ── Step 2: 确认 schema.sql ───────────────────────────────────────────────────
header "Step 2: 确认 schema.sql"

if [[ ! -f "$SCHEMA_DEST" ]]; then
  if [[ -f "$SCHEMA_SRC" ]]; then
    if $DRY_RUN; then
      info "[dry-run] cp $SCHEMA_SRC → $SCHEMA_DEST"
    else
      cp "$SCHEMA_SRC" "$SCHEMA_DEST"
      ok "schema.sql 已复制 → $SCHEMA_DEST"
    fi
  else
    err "schema.sql 不存在: $SCHEMA_SRC"
    err "请确认 everything_openclaw 已克隆至 ~/workspace-pandas/everything_openclaw"
    exit 1
  fi
else
  ok "schema.sql 已就绪: $SCHEMA_DEST"
fi

# ── Step 3: 初始化 project.db ─────────────────────────────────────────────────
header "Step 3: 初始化 project.db"

if ! command -v sqlite3 &>/dev/null; then
  warn "sqlite3 未安装 — 跳过 project.db 初始化"
  warn "请安装: apt install sqlite3"
  warn "安装后手动执行: sqlite3 ${DB_PATH} < ${SCHEMA_DEST}"
else
  if [[ -f "$DB_PATH" ]]; then
    ok "project.db 已存在，跳过（幂等）: $DB_PATH"
    info "验证表结构..."
    TABLES=$(sqlite3 "$DB_PATH" ".tables" 2>/dev/null || true)
    EXPECTED_TABLES="candidates decisions patterns project_facts"
    ALL_TABLES_OK=true
    for t in $EXPECTED_TABLES; do
      if echo "$TABLES" | grep -qw "$t"; then
        info "  ✓  table: $t"
      else
        warn "  ✗  table: $t 缺失 — 尝试重新应用 schema"
        ALL_TABLES_OK=false
      fi
    done
    if ! $ALL_TABLES_OK; then
      if $DRY_RUN; then
        info "[dry-run] sqlite3 $DB_PATH < $SCHEMA_DEST"
      else
        sqlite3 "$DB_PATH" < "$SCHEMA_DEST"
        ok "schema 已重新应用"
      fi
    fi
  else
    if $DRY_RUN; then
      info "[dry-run] sqlite3 $DB_PATH < $SCHEMA_DEST"
    else
      sqlite3 "$DB_PATH" < "$SCHEMA_DEST"
      ok "project.db 已创建: $DB_PATH"
    fi

    if ! $DRY_RUN; then
      TABLES=$(sqlite3 "$DB_PATH" ".tables" 2>/dev/null || true)
      for t in project_facts decisions patterns candidates; do
        if echo "$TABLES" | grep -qw "$t"; then
          info "  ✓  table: $t"
        else
          err "  ✗  table: $t 创建失败"
          exit 1
        fi
      done
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
