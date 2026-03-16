// USER BUG SYNC SERVICE — bug-standard.md §8
// Implements the four sync steps Pandas runs daily (§8.2).
// Pure domain logic: no file I/O, no shell calls — all external effects go through GhClient.

import type { BugFrontmatter, GhClient } from './types.js';

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

export interface SyncRegressingResult {
  /** Number of days remaining before the 14-day auto-close threshold */
  daysRemaining?: number;
}

export class UserBugSync {
  constructor(
    private readonly gh: GhClient,
    /** Inject current time for deterministic testing */
    private readonly now: () => Date = () => new Date(),
  ) {}

  // §8.2 step ① — GitHub→local close detection (TC-028-10)
  // If the GitHub issue has been closed by the user, sync local status to closed.
  async syncClose(bug: BugFrontmatter): Promise<void> {
    if (bug.bug_type !== 'user_bug' || bug.status !== 'regressing') return;
    const { state } = await this.gh.issueView(bug.github_issue);
    if (state === 'CLOSED') {
      bug.status = 'closed';
      const note = `GitHub issue #${bug.github_issue} closed by user, local status synced to closed`;
      bug.agent_notes = bug.agent_notes ? `${bug.agent_notes}\n${note}` : note;
    }
  }

  // §8.2 step ② — local status→GitHub label push (TC-028-21)
  // Keeps the status:* label on the GitHub issue in sync with local status.
  // Idempotent: no-op when labels are already consistent.
  async syncStatusLabel(bug: BugFrontmatter, currentLabels: string[]): Promise<void> {
    if (bug.bug_type !== 'user_bug') return;
    const currentStatusLabel = currentLabels.find((l) => l.startsWith('status:'));
    const newStatusLabel = `status:${bug.status}`;
    if (currentStatusLabel === newStatusLabel) return;
    if (currentStatusLabel) {
      await this.gh.issueRemoveLabel(bug.github_issue, currentStatusLabel);
    }
    await this.gh.issueAddLabel(bug.github_issue, newStatusLabel);
  }

  // §8.2 step ③ — regressing acceptance notification, idempotent (TC-028-11)
  // §8.2 step ④ — 14-day timeout auto-close (TC-028-12, TC-028-13)
  async syncRegressingNotification(bug: BugFrontmatter): Promise<SyncRegressingResult> {
    if (bug.bug_type !== 'user_bug' || bug.status !== 'regressing') return {};

    const today = this.now();
    const todayStr = today.toISOString().slice(0, 10);

    // Step ③: send notification once
    if (!bug.regressing_notified) {
      await this.gh.issueComment(
        bug.github_issue,
        `该 bug 的修复已通过内部回归测试，现请您在生产环境验收。若 14 天内未收到回复，本 issue 将自动关闭。`,
      );
      bug.regressing_notified = true;
      bug.regressing_notified_at = todayStr;
      return {};
    }

    // Step ④: check timeout
    const notifiedAt = new Date(bug.regressing_notified_at);
    const elapsed = today.getTime() - notifiedAt.getTime();
    const daysRemaining = Math.ceil((FOURTEEN_DAYS_MS - elapsed) / (1000 * 60 * 60 * 24));

    if (daysRemaining <= 0) {
      await this.gh.issueComment(
        bug.github_issue,
        '14天内未收到验收反馈，自动关闭。如有问题请重新提 issue。',
      );
      await this.gh.issueClose(bug.github_issue);
      bug.status = 'closed';
      const note = `14天无响应，Pandas 代关（issue #${bug.github_issue}）`;
      bug.agent_notes = bug.agent_notes ? `${bug.agent_notes}\n${note}` : note;
      return { daysRemaining: 0 };
    }

    return { daysRemaining };
  }

  // §8.1 — create local BUG work item from a new GitHub issue (TC-028-22)
  // Returns the YAML frontmatter string for the new BUG-xxx.md (caller handles FS write + commit).
  // Idempotent: if the issue already has bug-tracked label, returns { created: false }.
  async createBugFromIssue(
    issue: { number: number; title: string; labels: string[] },
    bugId: string,
  ): Promise<{ created: boolean; bugContent?: string }> {
    if (issue.labels.includes('bug-tracked')) {
      return { created: false };
    }
    const bugContent = [
      '---',
      `bug_id: ${bugId}`,
      `bug_type: user_bug`,
      `title: "${issue.title}"`,
      `status: open`,
      `github_issue: "${issue.number}"`,
      `owner: unassigned`,
      `related_req: []`,
      `related_tc: []`,
      `tc_policy: required`,
      `tc_exempt_reason: ""`,
      `reported_by: human`,
      `review_round: 0`,
      `depends_on: []`,
      `regressing_notified: false`,
      `regressing_notified_at: ""`,
      '---',
      '',
    ].join('\n');
    await this.gh.issueAddLabel(issue.number, 'bug-tracked');
    return { created: true, bugContent };
  }
}
