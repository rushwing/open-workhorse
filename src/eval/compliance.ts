/**
 * REQ-040: Harness Compliance Eval Suite
 *
 * Analyses feat/REQ-E00N git branches for 3 compliance steps:
 *   ① claim    — commit with owner change + status→in_progress
 *   ② pre-commit — ≥1 non-claim commit after claim
 *   ③ review   — HEAD REQ file has status: review
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepResult = '✓' | '✗' | '-';

export interface FixtureResult {
  id: string;
  claim: StepResult;
  preCommit: StepResult;
  review: StepResult;
  score: number;
  notRun: boolean;
}

export interface EvalResult {
  fixtures: FixtureResult[];
  passedSteps: number;
  totalSteps: number;
  compliance: number;
  baselineCompliance: number | null;
  regressionDetected: boolean;
  exitCode: number;
}

export interface BranchData {
  /** Full output of `git log -p feat/<id>`, or null if branch not found */
  gitLog: string | null;
  /** Content of the REQ file at HEAD of the branch, or null if not found */
  reqFileContent: string | null;
}

// ---------------------------------------------------------------------------
// Core logic (pure — no I/O, injectable for tests)
// ---------------------------------------------------------------------------

// Match diff-format line (+owner: claude_code) OR inline notation (owner: unassigned→claude_code)
const CLAIM_OWNER_PATTERN = /(\+owner:\s*claude_code|owner:\s*unassigned\s*[→]+\s*claude_code)/im;
// Match diff-format line (+status: in_progress) OR inline notation (status: xxx→in_progress)
const CLAIM_STATUS_PATTERN = /(\+status:\s*in_progress|status:\s*\w+\s*[→]+\s*in_progress)/im;
const REVIEW_STATUS_PATTERN = /^status:\s*review\s*$/im;

export function checkClaim(gitLog: string): boolean {
  return CLAIM_OWNER_PATTERN.test(gitLog) && CLAIM_STATUS_PATTERN.test(gitLog);
}

export function checkPreCommit(gitLog: string): boolean {
  // Split log into commits by "commit <sha>" lines
  const commits = gitLog.split(/^commit [0-9a-f]{40}/m).filter(s => s.trim().length > 0);
  // The first commit is newest (git log default order: newest first)
  // Find the claim commit index
  const claimIdx = commits.findIndex(c =>
    CLAIM_OWNER_PATTERN.test(c) && CLAIM_STATUS_PATTERN.test(c)
  );
  if (claimIdx === -1) return false;
  // Commits after claim are those with smaller index (newer)
  return claimIdx > 0;
}

export function checkReview(reqFileContent: string): boolean {
  return REVIEW_STATUS_PATTERN.test(reqFileContent);
}

export function evaluateFixture(id: string, data: BranchData): FixtureResult {
  if (data.gitLog === null) {
    return { id, claim: '-', preCommit: '-', review: '-', score: 0, notRun: true };
  }

  const claimPass = checkClaim(data.gitLog);

  let preCommitResult: StepResult;
  let reviewResult: StepResult;

  if (!claimPass) {
    preCommitResult = '-';
    reviewResult = '-';
    return {
      id,
      claim: '✗',
      preCommit: preCommitResult,
      review: reviewResult,
      score: 0,
      notRun: false,
    };
  }

  const preCommitPass = checkPreCommit(data.gitLog);
  preCommitResult = preCommitPass ? '✓' : '✗';

  const reviewPass = data.reqFileContent !== null && checkReview(data.reqFileContent);
  reviewResult = reviewPass ? '✓' : '✗';

  const score = [claimPass, preCommitPass, reviewPass].filter(Boolean).length;
  return {
    id,
    claim: '✓',
    preCommit: preCommitResult,
    review: reviewResult,
    score,
    notRun: false,
  };
}

export function runEval(
  fixtureIds: string[],
  getData: (id: string) => BranchData,
  baselineCompliance: number | null,
  updateBaseline: boolean
): EvalResult {
  const fixtures = fixtureIds.map(id => evaluateFixture(id, getData(id)));

  const runFixtures = fixtures.filter(f => !f.notRun);
  const passedSteps = runFixtures.reduce((sum, f) => sum + f.score, 0);
  const totalSteps = runFixtures.length * 3;
  const compliance = totalSteps > 0 ? passedSteps / totalSteps : 0;

  let regressionDetected = false;
  let exitCode = 0;

  if (runFixtures.length === 0) {
    exitCode = 1;
  } else if (updateBaseline) {
    exitCode = 0;
  } else {
    const anyFail = fixtures.some(f => !f.notRun && f.score < 3);
    if (anyFail) exitCode = 1;

    if (baselineCompliance !== null) {
      const delta = compliance - baselineCompliance;
      if (delta < -0.10) {
        regressionDetected = true;
        exitCode = 1;
      }
    }
  }

  return {
    fixtures,
    passedSteps,
    totalSteps,
    compliance,
    baselineCompliance,
    regressionDetected,
    exitCode,
  };
}

// ---------------------------------------------------------------------------
// Report rendering
// ---------------------------------------------------------------------------

export function renderReport(result: EvalResult, date: string): string {
  const pct = (n: number) => (n * 100).toFixed(1) + '%';

  const header = `## Harness Compliance Report — ${date}\n`;
  const tableHeader = `| Task     | ① claim | ② pre-commit | ③ review | score |\n|----------|---------|-------------|---------|-------|`;

  const rows = result.fixtures.map(f => {
    if (f.notRun) {
      return `| ${f.id} |  not_run  |  not_run   | not_run |  -   |`;
    }
    const c1 = f.claim.padStart(3).padEnd(5);
    const c2 = f.preCommit.padStart(5).padEnd(8);
    const c3 = f.review.padStart(5).padEnd(5);
    return `| ${f.id} |  ${c1}  |    ${c2}   |  ${c3}  | ${f.score}/3  |`;
  });

  const complianceLine = `\nCompliance: ${pct(result.compliance)} (${result.passedSteps}/${result.totalSteps} steps)`;

  let baselineLine = '';
  if (result.baselineCompliance !== null) {
    const delta = result.compliance - result.baselineCompliance;
    const deltaStr = (delta >= 0 ? '+' : '') + pct(delta);
    baselineLine = `\nBaseline:   ${pct(result.baselineCompliance)} (delta: ${deltaStr})`;
    if (result.regressionDetected) {
      baselineLine += ' — REGRESSION DETECTED';
    }
  }

  return [header, tableHeader, ...rows, complianceLine, baselineLine].join('\n');
}

// ---------------------------------------------------------------------------
// Real git provider (used when running as CLI)
// ---------------------------------------------------------------------------

function realGetData(projectRoot: string): (id: string) => BranchData {
  return (id: string): BranchData => {
    const branch = `feat/${id}`;

    // Check if branch exists
    const checkResult = spawnSync('git', ['rev-parse', '--verify', branch], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    if (checkResult.status !== 0) {
      return { gitLog: null, reqFileContent: null };
    }

    // Get git log with patch
    const logResult = spawnSync('git', ['log', '-p', branch], {
      cwd: projectRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    const gitLog = logResult.status === 0 ? logResult.stdout : null;

    // Get REQ file content at HEAD of branch
    const reqFilePath = `eval/fixtures/${id}.md`;
    const showResult = spawnSync('git', ['show', `${branch}:${reqFilePath}`], {
      cwd: projectRoot,
      encoding: 'utf8',
    });
    const reqFileContent = showResult.status === 0 ? showResult.stdout : null;

    return { gitLog, reqFileContent };
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function main() {
  const projectRoot = process.cwd();
  const args = process.argv.slice(2);
  const updateBaseline = args.includes('--update-baseline');

  const fixtureIds = ['REQ-E001', 'REQ-E002', 'REQ-E003'];

  // Read baseline
  const baselineFile = join(projectRoot, 'eval', 'baseline.json');
  let baselineCompliance: number | null = null;
  try {
    const raw = readFileSync(baselineFile, 'utf8');
    const parsed = JSON.parse(raw) as { compliance?: number };
    if (typeof parsed.compliance === 'number') {
      baselineCompliance = parsed.compliance;
    }
  } catch {
    // No baseline yet
  }

  const getData = realGetData(projectRoot);

  if (updateBaseline) {
    // Run eval to get current compliance, then write baseline
    const result = runEval(fixtureIds, getData, null, true);

    if (result.fixtures.every(f => f.notRun)) {
      console.error('eval:compliance: no eval sessions found — no feat/REQ-E00N branches exist');
      process.exit(1);
    }

    const newBaseline = { compliance: parseFloat(result.compliance.toFixed(4)) };
    mkdirSync(dirname(baselineFile), { recursive: true });
    writeFileSync(baselineFile, JSON.stringify(newBaseline, null, 2) + '\n');
    console.log(`Baseline updated: ${(result.compliance * 100).toFixed(1)}%`);

    // Also write last-run.md
    const date = new Date().toISOString().slice(0, 10);
    const report = renderReport({ ...result, baselineCompliance: null, regressionDetected: false }, date);
    const lastRunFile = join(projectRoot, 'eval', 'last-run.md');
    mkdirSync(dirname(lastRunFile), { recursive: true });
    writeFileSync(lastRunFile, report + '\nBaseline updated.\n');
    process.exit(0);
  }

  const result = runEval(fixtureIds, getData, baselineCompliance, false);

  if (result.fixtures.every(f => f.notRun)) {
    console.error('eval:compliance: no eval sessions found — no feat/REQ-E00N branches exist');
    process.exit(1);
  }

  const date = new Date().toISOString().slice(0, 10);
  const report = renderReport(result, date);

  // Write last-run.md
  const lastRunFile = join(projectRoot, 'eval', 'last-run.md');
  mkdirSync(dirname(lastRunFile), { recursive: true });
  writeFileSync(lastRunFile, report + '\n');

  console.log(report);

  if (result.regressionDetected) {
    console.error('REGRESSION DETECTED');
  }

  process.exit(result.exitCode);
}

// Run as CLI if this file is the entry point
if (require.main === module) {
  main();
}
