#!/usr/bin/env bash
# check-bug-coverage.sh — BUG frontmatter 字段完整性与枚举合规校验
#
# 用法：bash scripts/check-bug-coverage.sh
#        npm run bug:check
#
# 退出码：0 = 通过（含 warn 级别）；1 = 存在 error 级别问题

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
err()  { echo -e "${RED}[bug:check ERROR]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[bug:check WARN]${NC} $*"; }
ok()   { echo -e "${GREEN}[bug:check]${NC} $*"; }

# ── 枚举常量 ──────────────────────────────────────────────────────────────────
VALID_BUG_TYPES="req_bug tc_bug impl_bug ci_bug user_bug"
VALID_STATUSES="open confirmed in_progress fixed regressing blocked closed wont_fix"
VALID_OWNERS="unassigned pandas huahua menglan claude_code human"

# ── 工具 ─────────────────────────────────────────────────────────────────────
get_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

in_set() {
  local val="$1" set="$2"
  for item in $set; do
    [[ "$item" == "$val" ]] && return 0
  done
  return 1
}

# ── 主逻辑 ───────────────────────────────────────────────────────────────────
BUGS_DIR="tasks/bugs"

if [[ ! -d "$BUGS_DIR" ]]; then
  ok "tasks/bugs/ 目录不存在，跳过检查"
  exit 0
fi

shopt -s nullglob
files=("$BUGS_DIR"/BUG-*.md)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  ok "no BUG files found, skipping"
  exit 0
fi

ERRORS=0
WARNINGS=0

for f in "${files[@]}"; do
  bug_id="$(get_field "$f" "bug_id")"
  label="${bug_id:-$f}"

  # ── 必填字段存在性检查 ─────────────────────────────────────────────────────
  for field in bug_id bug_type title status severity priority owner reported_by review_round; do
    val="$(get_field "$f" "$field")"
    if [[ -z "$val" ]]; then
      err "${label}: 缺少必填字段 '${field}'"
      (( ERRORS++ )) || true
    fi
  done

  # ── 枚举值校验 ────────────────────────────────────────────────────────────
  bug_type="$(get_field "$f" "bug_type")"
  if [[ -n "$bug_type" ]] && ! in_set "$bug_type" "$VALID_BUG_TYPES"; then
    err "${label}: bug_type='${bug_type}' 不在允许枚举中（${VALID_BUG_TYPES}）"
    (( ERRORS++ )) || true
  fi

  status="$(get_field "$f" "status")"
  if [[ -n "$status" ]] && ! in_set "$status" "$VALID_STATUSES"; then
    err "${label}: status='${status}' 不在允许枚举中（${VALID_STATUSES}）"
    (( ERRORS++ )) || true
  fi

  owner="$(get_field "$f" "owner")"
  if [[ -n "$owner" ]] && ! in_set "$owner" "$VALID_OWNERS"; then
    err "${label}: owner='${owner}' 不在允许枚举中（${VALID_OWNERS}）"
    (( ERRORS++ )) || true
  fi

  # ── review_round 为非负整数 ───────────────────────────────────────────────
  review_round="$(get_field "$f" "review_round")"
  if [[ -n "$review_round" ]] && ! [[ "$review_round" =~ ^[0-9]+$ ]]; then
    err "${label}: review_round='${review_round}' 不是非负整数"
    (( ERRORS++ )) || true
  fi

  # ── status=blocked 时 blocked_reason + blocked_from_status 非空 ───────────
  if [[ "$status" == "blocked" ]]; then
    blocked_reason="$(get_field "$f" "blocked_reason")"
    blocked_from_status="$(get_field "$f" "blocked_from_status")"
    if [[ -z "$blocked_reason" ]]; then
      err "${label}: status=blocked 但 blocked_reason 为空"
      (( ERRORS++ )) || true
    fi
    if [[ -z "$blocked_from_status" ]]; then
      err "${label}: status=blocked 但 blocked_from_status 为空"
      (( ERRORS++ )) || true
    fi
  fi

  # ── status=in_progress 时 owner != unassigned ─────────────────────────────
  if [[ "$status" == "in_progress" && "$owner" == "unassigned" ]]; then
    err "${label}: status=in_progress 但 owner=unassigned（必须已认领）"
    (( ERRORS++ )) || true
  fi

  # ── status=fixed 时 related_tc 非空（warn 级别）──────────────────────────
  if [[ "$status" == "fixed" ]]; then
    related_tc="$(get_field "$f" "related_tc")"
    # 去掉 [] 后检查是否为空
    tc_clean="$(echo "$related_tc" | tr -d '[] ')"
    if [[ -z "$tc_clean" ]]; then
      warn "${label}: status=fixed 但 related_tc 为空（建议填写回归 TC）"
      (( WARNINGS++ )) || true
    fi
  fi

done

# ── 结果汇总 ─────────────────────────────────────────────────────────────────
echo ""
if [[ $ERRORS -gt 0 ]]; then
  err "共 ${ERRORS} 个错误，${WARNINGS} 个警告 — bug:check FAILED"
  exit 1
else
  ok "共检查 ${#files[@]} 个 BUG 文件，${WARNINGS} 个警告 — bug:check PASSED"
  exit 0
fi
