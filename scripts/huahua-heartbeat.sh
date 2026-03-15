#!/usr/bin/env bash
# huahua-heartbeat.sh — Huahua inbox 心跳处理器
#
# 用法:
#   bash scripts/huahua-heartbeat.sh   # 由 cron 每 5 分钟调用
#
# 行为:
#   inbox 为空 → 立即退出（零 token，~0.001s CPU）
#   有消息    → 读取 type/req_id → 调用 harness.sh 处理 → 删除消息文件
#
# 依赖环境变量（.env）:
#   SHARED_RESOURCES_ROOT  — 共享收件箱根目录（默认 ~/Dev/everything_openclaw/personas/shared-resources）
#   REPO_ROOT              — open-workhorse 仓库根目录（自动检测）

set -euo pipefail

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$REPO_ROOT"

# 加载 .env
if [[ -f "$REPO_ROOT/.env" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "$line" ]] && continue
    [[ "$line" =~ ^(SHARED_RESOURCES_ROOT) ]] || continue
    local_var="${line%%=*}"
    [[ "${!local_var+X}" == "X" ]] && continue
    export "$line" 2>/dev/null || true
  done < "$REPO_ROOT/.env"
fi

INBOX="${SHARED_RESOURCES_ROOT:-${HOME}/Dev/everything_openclaw/personas/shared-resources}/inbox/for-huahua"

# ── 辅助函数 ──────────────────────────────────────────────────────────────────
CYAN='\033[0;36m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${CYAN}[huahua]${NC} $*"; }
warn() { echo -e "${YELLOW}[huahua]${NC} $*"; }
ok()   { echo -e "${GREEN}[huahua]${NC} $*"; }

_get_fm_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
main() {
  # 空则秒退（零 token）
  msg=$(ls "${INBOX}"/*.md 2>/dev/null | head -1 || true)
  [[ -z "$msg" ]] && exit 0

  info "huahua-heartbeat 开始（$(date -u +%Y-%m-%dT%H:%M:%SZ)）"

  for msg_file in "${INBOX}"/*.md; do
    [[ -f "$msg_file" ]] || continue

    local type req_id pr_number summary status
    type="$(_get_fm_field "$msg_file" "type")"
    req_id="$(_get_fm_field "$msg_file" "req_id")"
    pr_number="$(_get_fm_field "$msg_file" "pr_number")"
    summary="$(_get_fm_field "$msg_file" "summary")"
    status="$(_get_fm_field "$msg_file" "status")"

    info "处理消息: type=${type} req_id=${req_id} pr=${pr_number:-none} status=${status:-none}"
    info "summary: ${summary}"

    # harness.sh CLAUDE_CMD setup (mirrors harness.sh §CLAUDE_CMD)
    CLAUDE_CMD=(claude --dangerously-skip-permissions -p)
    if [[ -n "${CLAUDE_APPROVAL+x}" && -z "${CLAUDE_APPROVAL}" ]]; then
      CLAUDE_CMD=(claude -p)
    elif [[ -n "${CLAUDE_APPROVAL:-}" ]]; then
      CLAUDE_CMD=(claude "$CLAUDE_APPROVAL" -p)
    fi

    case "$type" in
      tc_design)
        # tc_design with pr_number = fix findings on existing TC PR (PANDAS-ORCHESTRATION §7)
        # tc_design without pr_number = design TCs from scratch and open a TC PR
        if [[ -n "$pr_number" ]]; then
          info "tc_design (fix iteration) → harness.sh fix-review ${pr_number}"
          bash "$REPO_ROOT/scripts/harness.sh" fix-review "$pr_number"
        else
          info "tc_design (initial) → claude -p TC design for ${req_id}"
          local req_file="tasks/features/${req_id}.md"
          local req_content=""
          [[ -f "$req_file" ]] && req_content="$(cat "$req_file")"
          "${CLAUDE_CMD[@]}" "Read harness/harness-index.md and harness/testing-standard.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

Your task: design test cases for ${req_id} and open a TC PR.

## REQ content
${req_content:-"(REQ file not found at ${req_file}. Use the req_id to locate it.)"}

## Steps
1. Create branch: tc/${req_id}-<short-slug>
2. Read the REQ acceptance criteria carefully
3. For each acceptance criterion, write at least one test case file under tasks/test_cases/
4. Commit TC files with message: 'tc: ${req_id} test case design'
5. Open PR with: gh pr create --fill
6. Reply summary of TCs designed and the PR URL"
        fi
        ;;
      code_review)
        # code_review = Huahua reviews Menglan's dev PR (PANDAS-ORCHESTRATION §8)
        if [[ -z "$pr_number" ]]; then
          warn "code_review 消息缺少 pr_number，跳过（msg: $(basename "$msg_file")）"
          rm -f "$msg_file"
          continue
        fi
        info "code_review → claude -p review PR #${pr_number} for ${req_id}"
        local pr_diff=""
        pr_diff="$(gh pr diff "$pr_number" 2>/dev/null || echo "(unable to fetch diff)")"
        "${CLAUDE_CMD[@]}" "Read harness/harness-index.md.
Do not ask clarifying questions — proceed with your best judgment at every step.

Your task: review dev PR #${pr_number} for ${req_id}.

## Diff
${pr_diff}

## Steps
1. Read the diff above and any referenced files
2. Check for: bugs, regressions, unsafe assumptions, missing tests, data integrity risks
3. Post review using: gh pr review ${pr_number} --request-changes -b '<findings>' OR gh pr review ${pr_number} --approve -b 'LGTM'
4. If approved, write inbox message to ${SHARED_RESOURCES_ROOT:-\${HOME}/Dev/everything_openclaw/personas/shared-resources}/inbox/for-pandas/ with type=dev_complete, req_id=${req_id}, pr_number=${pr_number}, status=success
5. If changes requested, write inbox message to ${SHARED_RESOURCES_ROOT:-\${HOME}/Dev/everything_openclaw/personas/shared-resources}/inbox/for-pandas/ with type=review_blocked, req_id=${req_id}, pr_number=${pr_number}, status=blocked, blocking_reason=<summary>"
        ;;
      *)
        warn "未知消息类型: ${type}（文件: $(basename "$msg_file")）— 已跳过"
        ;;
    esac

    # 消费消息（删除已处理文件）
    rm -f "$msg_file"
    ok "消费消息: $(basename "$msg_file")"
  done

  info "huahua-heartbeat 完成"
}

main "$@"
