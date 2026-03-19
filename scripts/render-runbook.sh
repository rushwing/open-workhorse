#!/usr/bin/env bash
# scripts/render-runbook.sh — 渲染 Pandas RUNBOOK.md（模板 + adapter → 部署版本）
#
# 用法:
#   bash scripts/render-runbook.sh              # 正常渲染
#   bash scripts/render-runbook.sh --dry-run    # 预览，不写入输出文件
#
# 渲染流程:
#   1. 定位模板: everything_openclaw/personas/workspace-pandas/RUNBOOK.md
#   2. 加载 adapter: everything_openclaw/personas/workspace-pandas/RUNBOOK.adapter.yaml
#   3. 验证必需 binding 均存在
#   4. 替换静态占位符（路径/命令/commit 绑定）
#      保留运行时 token: {REQ_ID}, {BUG_ID}, {PR_NUMBER}, {RESULT_TYPE}
#   5. 写入输出: ~/workspace-pandas/RUNBOOK.md
#
# 依赖: bash, sed, grep（无额外 runtime 依赖）

set -euo pipefail

# ── 路径定义 ────────────────────────────────────────────────────────────────
WORKSPACE_ROOT="$HOME"
EC_ROOT="$WORKSPACE_ROOT/workspace-pandas/everything_openclaw"
ADAPTER_DIR="$EC_ROOT/personas/workspace-pandas"
TEMPLATE="$ADAPTER_DIR/RUNBOOK.md"
ADAPTER="$ADAPTER_DIR/RUNBOOK.adapter.yaml"
OUTPUT="$WORKSPACE_ROOT/workspace-pandas/RUNBOOK.md"

# ── 参数解析 ────────────────────────────────────────────────────────────────
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --*) echo "未知选项: $arg" >&2; exit 1 ;;
  esac
done

# ── 颜色 ─────────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

info()   { echo -e "${CYAN}[render-runbook]${NC} $*"; }
ok()     { echo -e "${GREEN}[render-runbook]${NC} $*"; }
warn()   { echo -e "${YELLOW}[render-runbook]${NC} $*"; }
err()    { echo -e "${RED}[render-runbook]${NC} $*" >&2; }
header() { echo -e "\n${BOLD}── $* ${NC}"; }

echo -e "${BOLD}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     open-workhorse — render-runbook              ║"
echo "║     Pandas RUNBOOK.md 渲染管线                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"
$DRY_RUN && echo -e "  ${YELLOW}mode : DRY RUN（不写入文件）${NC}\n"

# ── Step 1: 确认 template ────────────────────────────────────────────────────
header "Step 1: 确认 RUNBOOK.md 模板"

if [[ ! -f "$TEMPLATE" ]]; then
  warn "RUNBOOK.md 模板尚未编写: $TEMPLATE"
  warn "模板由 everything_openclaw 团队编写后方可渲染"
  warn "当前跳过渲染（graceful exit 0）"
  echo ""
  info "adapter 文件状态:"
  [[ -f "$ADAPTER" ]] && ok "  adapter 已就绪: $ADAPTER" || warn "  adapter 缺失: $ADAPTER"
  exit 0
fi

ok "模板已就绪: $TEMPLATE"

# ── Step 2: 确认 adapter ─────────────────────────────────────────────────────
header "Step 2: 确认 RUNBOOK.adapter.yaml"

if [[ ! -f "$ADAPTER" ]]; then
  err "adapter 不存在: $ADAPTER"
  err "请确认 everything_openclaw 已克隆至 ~/workspace-pandas/everything_openclaw"
  exit 1
fi

ok "adapter 已就绪: $ADAPTER"

# ── Step 3: 验证必需 binding ──────────────────────────────────────────────────
header "Step 3: 验证必需 binding"

REQUIRED_BINDINGS=(
  PHASE_ROOT
  REQ_ROOT
  BUG_ROOT
  TC_ROOT
  WORKER_STATUS_SOURCE
  TASK_DEPENDENCY_SOURCE
  PR_METADATA_SOURCE
  NOTIFY_DECISION_COMMAND
  NOTIFY_PR_READY_COMMAND
  TC_REVIEW_TRIGGER
  REQ_ENTRY_HANDOFF_COMMIT
  BUG_CONFIRM_COMMIT
  BUG_ROUTE_COMMIT
  REVIEW_ROUTE_COMMIT
  TASK_ARCHIVE_DONE_PATH
  ARCHIVE_WORK_ITEM_COMMIT
)

ALL_BINDINGS_OK=true
for binding in "${REQUIRED_BINDINGS[@]}"; do
  if grep -q "^  ${binding}:" "$ADAPTER" 2>/dev/null; then
    info "  ✓  $binding"
  else
    err "  ✗  $binding (adapter 中缺失)"
    ALL_BINDINGS_OK=false
  fi
done

if ! $ALL_BINDINGS_OK; then
  err "adapter 缺少必需 binding — 中止渲染"
  exit 1
fi

ok "所有必需 binding 已验证"

# ── Step 4: 提取 binding 值 ───────────────────────────────────────────────────
header "Step 4: 提取 binding 值"

# Extract a binding value from the adapter yaml (simple key: value lines under bindings:)
get_binding() {
  local key="$1"
  # Match lines like "  KEY: value" or "  KEY: 'value with spaces'"
  local raw
  raw=$(grep -A 200 '^bindings:' "$ADAPTER" | grep "^  ${key}:" | head -1 | sed "s/^  ${key}:[[:space:]]*//" | tr -d '"'"'" || true)
  echo "$raw"
}

# Reserved runtime tokens — must NOT be substituted
RESERVED_TOKENS=(REQ_ID BUG_ID PR_NUMBER RESULT_TYPE)

# Build a temp file with substitutions applied
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

cp "$TEMPLATE" "$TMPFILE"

SUBSTITUTION_COUNT=0
for binding in "${REQUIRED_BINDINGS[@]}"; do
  value=$(get_binding "$binding")
  if [[ -n "$value" ]]; then
    # Use | as sed delimiter to handle paths with /
    sed -i "s|{${binding}}|${value}|g" "$TMPFILE"
    SUBSTITUTION_COUNT=$((SUBSTITUTION_COUNT + 1))
    info "  ↳  {${binding}} → ${value}"
  fi
done

# Verify reserved tokens are still intact (not accidentally substituted)
for token in "${RESERVED_TOKENS[@]}"; do
  if grep -q "{${token}}" "$TMPFILE"; then
    info "  ✓  reserved token preserved: {${token}}"
  fi
done

ok "$SUBSTITUTION_COUNT binding(s) 已替换"

# ── Step 5: 写入输出 ──────────────────────────────────────────────────────────
header "Step 5: 写入渲染输出"

OUTPUT_DIR="$(dirname "$OUTPUT")"
if [[ ! -d "$OUTPUT_DIR" ]]; then
  err "输出目录不存在: $OUTPUT_DIR"
  exit 1
fi

if $DRY_RUN; then
  info "[dry-run] 渲染输出将写入: $OUTPUT"
  info "[dry-run] 前 10 行预览:"
  head -10 "$TMPFILE" | sed 's/^/  /'
else
  # Prepend generated metadata frontmatter
  ADAPTER_REL="personas/workspace-pandas/RUNBOOK.adapter.yaml"
  TEMPLATE_REL="personas/workspace-pandas/RUNBOOK.md"
  DATESTAMP=$(date -I 2>/dev/null || date +%Y-%m-%d)

  {
    echo "<!-- generated_from_template: ${TEMPLATE_REL} -->"
    echo "<!-- generated_from_adapter: ${ADAPTER_REL} -->"
    echo "<!-- generated_for_project: open_workhorse -->"
    echo "<!-- generated_for_agent: pandas -->"
    echo "<!-- generated_at: ${DATESTAMP} -->"
    echo "<!-- DO NOT EDIT — re-render with: npm run runbook:render -->"
    echo ""
    cat "$TMPFILE"
  } > "$OUTPUT"

  ok "渲染完成: $OUTPUT"
fi

echo -e "${GREEN}${BOLD}"
if $DRY_RUN; then
  echo "dry-run 完成 — 未写入任何文件"
else
  echo "render-runbook 完成"
fi
echo -e "${NC}"
