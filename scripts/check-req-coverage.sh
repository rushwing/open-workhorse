#!/usr/bin/env bash
# check-req-coverage.sh — REQ frontmatter 校验与覆盖率检查
#
# 用法:
#   bash scripts/check-req-coverage.sh        # 报告模式
#   bash scripts/check-req-coverage.sh        # 退出码：0=pass, 1=fail（供 CI）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
WARN_COUNT=0
ERROR_COUNT=0

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓${NC} $*"; }
fail() { echo -e "${RED}  ✗${NC} $*"; FAIL=1; (( ERROR_COUNT++ )) || true; }
warn() { echo -e "${YELLOW}  ⚠${NC} $*"; (( WARN_COUNT++ )) || true; }

# ── 工具函数 ──────────────────────────────────────────────────────────────────

get_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

get_array_field() {
  # 提取 YAML 数组字段值，格式如 [TC-001, TC-002] 或 []
  local file="$1" field="$2"
  local raw
  raw="$(awk -F': ' "/^${field}:/{for(i=2;i<=NF;i++) printf \$i; print \"\"}" "$file" | tr -d '[]')"
  echo "$raw"
}

check_enum() {
  local val="$1" allowed="$2" context="$3"
  local found=false
  for a in $allowed; do
    if [[ "$val" == "$a" ]]; then found=true; break; fi
  done
  if ! $found; then
    fail "$context: 值 '$val' 不在允许枚举 [$allowed] 内"
  fi
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────

# 检查 tasks/features/ 是否存在
if [[ ! -d "tasks/features" ]]; then
  echo "check-req-coverage: tasks/features/ 目录不存在，跳过检查"
  exit 0
fi

# 收集所有 REQ 文件
REQ_FILES=()
for f in tasks/features/REQ-*.md; do
  [[ -f "$f" ]] && REQ_FILES+=("$f")
done

if [[ ${#REQ_FILES[@]} -eq 0 ]]; then
  echo "check-req-coverage: no REQ files found, skipping"
  exit 0
fi

echo "check-req-coverage: 检查 ${#REQ_FILES[@]} 个需求文件..."
echo ""

REQUIRED_FIELDS=("req_id" "title" "status" "priority" "phase" "owner" "depends_on" "test_case_ref" "scope" "acceptance")
STATUS_ENUM="draft ready test_designed in_progress blocked review done"
SCOPE_ENUM="runtime ui tests scripts docs"
PRIORITY_ENUM="P0 P1 P2 P3"
OWNER_ENUM="unassigned pandas huahua menglan claude_code human"

# 收集所有 TC 文件（用于 orphan 检测）
ALL_TC_REFS=()

for req_file in "${REQ_FILES[@]}"; do
  req_id="$(get_field "$req_file" "req_id")"
  echo "── ${req_id} (${req_file})"

  # 1. frontmatter 字段完整性检查
  for field in "${REQUIRED_FIELDS[@]}"; do
    val="$(get_field "$req_file" "$field")"
    if [[ -z "$val" ]]; then
      fail "${req_id}: 缺少字段 '${field}'"
    fi
  done

  # 2. 枚举值检查
  status="$(get_field "$req_file" "status")"
  priority="$(get_field "$req_file" "priority")"
  scope="$(get_field "$req_file" "scope")"
  owner="$(get_field "$req_file" "owner")"

  [[ -n "$status" ]] && check_enum "$status" "$STATUS_ENUM" "${req_id}.status"
  [[ -n "$priority" ]] && check_enum "$priority" "$PRIORITY_ENUM" "${req_id}.priority"
  [[ -n "$scope" ]] && check_enum "$scope" "$SCOPE_ENUM" "${req_id}.scope"
  [[ -n "$owner" ]] && check_enum "$owner" "$OWNER_ENUM" "${req_id}.owner"

  # 3. depends_on 引用存在性检查
  depends_on="$(get_array_field "$req_file" "depends_on")"
  if [[ -n "$depends_on" ]]; then
    IFS=',' read -ra deps <<< "$depends_on"
    for dep in "${deps[@]}"; do
      dep="$(echo "$dep" | tr -d ' ')"
      [[ -z "$dep" ]] && continue
      # 搜索 tasks/ 全目录
      found_dep=false
      for d in tasks/features/"${dep}".md tasks/bugs/"${dep}".md tasks/archive/done/"${dep}".md; do
        [[ -f "$d" ]] && found_dep=true && break
      done
      if ! $found_dep; then
        fail "${req_id}: depends_on 引用 '${dep}' 不存在"
      fi
    done
  fi

  # 4. test_designed 时 test_case_ref 非空
  test_case_ref="$(get_array_field "$req_file" "test_case_ref")"
  if [[ "$status" == "test_designed" && -z "$(echo "$test_case_ref" | tr -d ' ')" ]]; then
    fail "${req_id}: status=test_designed 但 test_case_ref 为空"
  fi

  # 5. test_case_ref 中的 TC 文件存在性检查
  if [[ -n "$(echo "$test_case_ref" | tr -d ' ')" ]]; then
    IFS=',' read -ra tcs <<< "$test_case_ref"
    for tc in "${tcs[@]}"; do
      tc="$(echo "$tc" | tr -d ' ')"
      [[ -z "$tc" ]] && continue
      ALL_TC_REFS+=("$tc")
      tc_file="tasks/test-cases/${tc}.md"
      if [[ ! -f "$tc_file" ]]; then
        fail "${req_id}: test_case_ref 中的 '${tc}' 不存在于 tasks/test-cases/"
      fi
    done
  fi

  # 6. in_progress 时 owner != unassigned
  if [[ "$status" == "in_progress" && "$owner" == "unassigned" ]]; then
    fail "${req_id}: status=in_progress 但 owner=unassigned"
  fi

  # 8. blocked 时 blocked_reason 非空
  if [[ "$status" == "blocked" ]]; then
    blocked_reason="$(get_field "$req_file" "blocked_reason")"
    if [[ -z "$blocked_reason" || "$blocked_reason" == '""' ]]; then
      fail "${req_id}: status=blocked 但 blocked_reason 为空或缺失"
    fi
  fi

  # 9. blocked 时 blocked_from_status 非空
  if [[ "$status" == "blocked" ]]; then
    blocked_from_status="$(get_field "$req_file" "blocked_from_status")"
    if [[ -z "$blocked_from_status" || "$blocked_from_status" == '""' ]]; then
      fail "${req_id}: status=blocked 但 blocked_from_status 为空或缺失"
    fi
  fi

  # 7. tc_policy 检查
  tc_policy="$(get_field "$req_file" "tc_policy")"
  if [[ -n "$tc_policy" ]]; then
    check_enum "$tc_policy" "required optional exempt" "${req_id}.tc_policy"

    # tc_policy=exempt 时 tc_exempt_reason 非空
    if [[ "$tc_policy" == "exempt" ]]; then
      tc_exempt_reason="$(get_field "$req_file" "tc_exempt_reason")"
      if [[ -z "$tc_exempt_reason" || "$tc_exempt_reason" == '""' ]]; then
        fail "${req_id}: tc_policy=exempt 但 tc_exempt_reason 为空"
      fi
    fi

    # tc_policy=required + test_designed/in_progress/review/done 时 test_case_ref 非空
    if [[ "$tc_policy" == "required" ]]; then
      case "$status" in
        test_designed|in_progress|review|done)
          if [[ -z "$(echo "$test_case_ref" | tr -d ' ')" ]]; then
            fail "${req_id}: tc_policy=required, status=${status}，但 test_case_ref 为空"
          fi
          ;;
      esac
    fi
  fi

  ok "${req_id}: 基础检查通过"
  echo ""
done

# ── Orphan TC 检测 ────────────────────────────────────────────────────────────
if [[ -d "tasks/test-cases" ]]; then
  echo "── Orphan TC 检测"
  for tc_file in tasks/test-cases/TC-*.md; do
    [[ -f "$tc_file" ]] || continue
    tc_basename="$(basename "$tc_file" .md)"
    found_ref=false
    for ref in "${ALL_TC_REFS[@]+"${ALL_TC_REFS[@]}"}"; do
      if [[ "$ref" == "$tc_basename" ]]; then
        found_ref=true
        break
      fi
    done
    if ! $found_ref; then
      warn "Orphan TC: ${tc_file} 未被任何 REQ 引用"
    fi
  done
  echo ""
fi

# ── 总结 ──────────────────────────────────────────────────────────────────────
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GREEN}check-req-coverage: 全部通过 (warnings: ${WARN_COUNT})${NC}"
  exit 0
else
  echo -e "${RED}check-req-coverage: 发现 ${ERROR_COUNT} 个错误，${WARN_COUNT} 个警告${NC}"
  exit 1
fi
