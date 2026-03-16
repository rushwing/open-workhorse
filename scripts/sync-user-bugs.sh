#!/usr/bin/env bash
# sync-user-bugs.sh — user_bug 双向同步：GitHub issue ↔ tasks/bugs/BUG-xxx.md
#
# 用法：
#   bash scripts/sync-user-bugs.sh            # 完整同步（四步）
#   bash scripts/sync-user-bugs.sh --dry-run  # 只打印，不写文件不提交不调用 gh
#
# .env 配置项：
#   GITHUB_REPO  — 目标仓库，格式 owner/repo（默认从 git remote 自动检测）
#
# 依赖：gh CLI（https://cli.github.com/）、git
#
# 四步执行顺序：
#   ① GitHub → 本地：检测 issue 是否已被用户关闭 → 本地 status 推进到 closed
#   ② 本地 → GitHub：同步本地 status 到 issue label
#   ③ regressing 验收通知：首次进入 regressing 时向用户发送验收 comment（一次性）
#   ④ 14 天超时：超时后自动关闭 issue + 本地 closed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# shellcheck source=/dev/null
[[ -f ".env" ]] && source ".env"

# ── 颜色 ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { echo -e "${CYAN}[sync-user-bugs]${NC} $*"; }
ok()   { echo -e "${GREEN}[sync-user-bugs ✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[sync-user-bugs ⚠]${NC} $*"; }
err()  { echo -e "${RED}[sync-user-bugs ✗]${NC} $*" >&2; }

# ── 参数 ──────────────────────────────────────────────────────────────────────
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true
$DRY_RUN && info "DRY-RUN 模式：不写文件、不提交、不调用 gh 写操作"

# ── 依赖检查 ──────────────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
  err "gh CLI 未找到。请先安装：https://cli.github.com/"
  exit 1
fi

# ── 检测 GITHUB_REPO ──────────────────────────────────────────────────────────
if [[ -z "${GITHUB_REPO:-}" ]]; then
  remote_url="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "$remote_url" =~ github\.com[:/]([^/]+/[^/.]+)(\.git)?$ ]]; then
    GITHUB_REPO="${BASH_REMATCH[1]}"
  fi
fi

if [[ -z "${GITHUB_REPO:-}" ]]; then
  err "无法自动检测 GITHUB_REPO，请在 .env 中设置 GITHUB_REPO=owner/repo"
  exit 1
fi

info "目标仓库：${GITHUB_REPO}"

# ── 工具函数 ──────────────────────────────────────────────────────────────────

# 读取 frontmatter 字段值
get_field() {
  local file="$1" field="$2"
  awk -F': ' "/^${field}:/{gsub(/^[[:space:]]+|[[:space:]]+$/, \"\", \$2); print \$2; exit}" "$file"
}

# 更新已存在的 frontmatter 字段（标量值，不含特殊字符）
set_field() {
  local file="$1" field="$2" value="$3"
  sed -i "s|^${field}: .*|${field}: ${value}|" "$file"
}

# 在 frontmatter 中指定字段之后插入新字段（用于首次写入 regressing_notified_at）
insert_field_after() {
  local file="$1" after_field="$2" new_field="$3" new_value="$4"
  sed -i "/^${after_field}: /a ${new_field}: ${new_value}" "$file"
}

# 追加内容到文件末尾（Agent Notes）
append_note() {
  local file="$1" content="$2"
  printf '\n%s\n' "$content" >> "$file"
}

# 计算某 YYYY-MM-DD 距今的天数（GNU date，适用于 Linux）
days_since() {
  local date_str="$1"
  local then now
  then="$(date -d "$date_str" +%s 2>/dev/null)" || { echo 0; return; }
  now="$(date +%s)"
  echo $(( (now - then) / 86400 ))
}

# 确保 GitHub label 存在（幂等，失败不中断）
ensure_label() {
  local label="$1"
  gh label create "$label" --repo "$GITHUB_REPO" --force &>/dev/null || true
}

# 移除旧 status:* label，添加新 label
sync_status_label() {
  local issue="$1" new_status="$2"
  # 获取当前所有 status:* label
  local old_labels
  old_labels="$(gh issue view "$issue" --repo "$GITHUB_REPO" \
    --json labels --jq '[.labels[].name | select(startswith("status:"))] | join(" ")' \
    2>/dev/null || true)"
  for old in $old_labels; do
    [[ "$old" != "status:${new_status}" ]] && \
      gh issue edit "$issue" --repo "$GITHUB_REPO" --remove-label "$old" &>/dev/null || true
  done
  gh issue edit "$issue" --repo "$GITHUB_REPO" --add-label "status:${new_status}" &>/dev/null || true
}

# ── 主逻辑 ────────────────────────────────────────────────────────────────────
BUGS_DIR="tasks/bugs"

if [[ ! -d "$BUGS_DIR" ]]; then
  info "tasks/bugs/ 目录不存在，跳过"
  exit 0
fi

shopt -s nullglob
all_files=("$BUGS_DIR"/BUG-*.md)
shopt -u nullglob

# 过滤出 user_bug 且未终态（closed/wont_fix）的文件
user_bug_files=()
for f in "${all_files[@]}"; do
  [[ "$(get_field "$f" "bug_type")" != "user_bug" ]] && continue
  status="$(get_field "$f" "status")"
  [[ "$status" == "closed" || "$status" == "wont_fix" ]] && continue
  user_bug_files+=("$f")
done

if [[ ${#user_bug_files[@]} -eq 0 ]]; then
  info "无需同步的 user_bug（已全部终态或不存在）"
  exit 0
fi

info "待同步 user_bug：${#user_bug_files[@]} 件"
echo ""

TODAY="$(date +%Y-%m-%d)"
SYNC_TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SYNC_ERRORS=0

# 预先确保常用 status label 存在（只做一次）
if ! $DRY_RUN; then
  for lbl in bug-tracked status:open status:confirmed status:in_progress \
              status:fixed status:regressing status:blocked status:closed status:wont_fix; do
    ensure_label "$lbl"
  done
fi

for f in "${user_bug_files[@]}"; do
  bug_id="$(get_field "$f" "bug_id")"
  github_issue="$(get_field "$f" "github_issue")"
  status="$(get_field "$f" "status")"
  regressing_notified="$(get_field "$f" "regressing_notified")"
  regressing_notified_at="$(get_field "$f" "regressing_notified_at")"

  if [[ -z "$github_issue" ]]; then
    warn "${bug_id}: github_issue 字段为空，跳过（请手动补填 GitHub issue 编号）"
    (( SYNC_ERRORS++ )) || true
    continue
  fi

  info "━━ ${bug_id}  issue=#${github_issue}  status=${status}"

  # ── Step ①: GitHub → 本地（关闭检测）──────────────────────────────────────
  if [[ "$status" == "regressing" ]]; then
    issue_state="$(gh issue view "$github_issue" --repo "$GITHUB_REPO" \
      --json state --jq '.state' 2>/dev/null || echo "UNKNOWN")"

    if [[ "$issue_state" == "CLOSED" ]]; then
      info "  ① issue #${github_issue} 已被用户关闭 → 本地 status → closed"
      if ! $DRY_RUN; then
        set_field "$f" "status" "closed"
        append_note "$f" "## Agent Notes — sync ${SYNC_TS}
GitHub issue #${github_issue} 已由用户关闭，本地同步 closed"
        git add "$f"
        git commit -m "sync: close ${bug_id} — GitHub issue #${github_issue} closed by user"
      fi
      ok "  ${bug_id} → closed（用户验收）"
      echo ""
      continue
    fi
  fi

  # ── Step ②: 本地 → GitHub（status label 同步）──────────────────────────────
  info "  ② 同步 label → status:${status}"
  if ! $DRY_RUN; then
    sync_status_label "$github_issue" "$status"
  fi

  # ── Step ③: regressing 验收通知（一次性）──────────────────────────────────
  if [[ "$status" == "regressing" && "$regressing_notified" != "true" ]]; then
    bug_title="$(get_field "$f" "title")"
    reported_by="$(get_field "$f" "reported_by")"
    pr_url="$(grep -oP 'https://github\.com/[^\s)>]+/pull/[0-9]+' "$f" | head -1 || true)"
    [[ -z "$pr_url" ]] && pr_url="（请查看 ${bug_id}.md Agent Notes 中的 PR 链接）"

    comment_body="Hi @${reported_by}，

该 bug 的修复已通过内部回归测试，请您在生产环境中验收。

**修复摘要**：${bug_title}
**相关 PR**：${pr_url}

如确认修复，请直接**关闭本 issue**；如仍有问题，请在此评论描述复现步骤。
若 14 天内未收到回复，本 issue 将自动关闭。

感谢您的反馈！"

    info "  ③ 发送 regressing 验收通知（首次）"
    if ! $DRY_RUN; then
      gh issue comment "$github_issue" --repo "$GITHUB_REPO" --body "$comment_body"
      set_field "$f" "regressing_notified" "true"
      if grep -q "^regressing_notified_at:" "$f"; then
        set_field "$f" "regressing_notified_at" "$TODAY"
      else
        insert_field_after "$f" "regressing_notified" "regressing_notified_at" "$TODAY"
      fi
      git add "$f"
      git commit -m "sync: notify user for ${bug_id} regression — issue #${github_issue}"
    fi
    ok "  ${bug_id}: 验收通知已发送（${TODAY}）"
    regressing_notified="true"
    regressing_notified_at="$TODAY"
  fi

  # ── Step ④: 14 天超时检测 ──────────────────────────────────────────────────
  if [[ "$status" == "regressing" \
     && "$regressing_notified" == "true" \
     && -n "$regressing_notified_at" ]]; then
    days="$(days_since "$regressing_notified_at")"
    if [[ "$days" -ge 14 ]]; then
      info "  ④ 超时 ${days} 天（通知日 ${regressing_notified_at}）→ 自动关闭"
      if ! $DRY_RUN; then
        gh issue comment "$github_issue" --repo "$GITHUB_REPO" \
          --body "14 天内未收到验收反馈，自动关闭本 issue。如问题仍存在，请重新提 issue。"
        gh issue close "$github_issue" --repo "$GITHUB_REPO"
        set_field "$f" "status" "closed"
        append_note "$f" "## Agent Notes — sync ${SYNC_TS}
14 天无响应，Pandas 代关（issue #${github_issue}，通知日 ${regressing_notified_at}）"
        git add "$f"
        git commit -m "sync: auto-close ${bug_id} — 14d no response (issue #${github_issue})"
      fi
      ok "  ${bug_id} → closed（14 天超时）"
    else
      remaining=$(( 14 - days ))
      info "  ④ 超时倒计时：还剩 ${remaining} 天（通知日 ${regressing_notified_at}）"
    fi
  fi

  echo ""
done

# ── 结果汇总 ──────────────────────────────────────────────────────────────────
echo ""
if [[ $SYNC_ERRORS -gt 0 ]]; then
  warn "同步完成，${SYNC_ERRORS} 件跳过（见上方 WARN）"
  exit 1
else
  ok "同步完成，共处理 ${#user_bug_files[@]} 件 user_bug"
  exit 0
fi
