/**
 * menglan-heartbeat tests — BUG-004 regression coverage
 *
 * Runs menglan-heartbeat.sh in a tmpdir-isolated environment via bash subprocesses.
 * Tests ATM action routing to verify no valid action dead-letters, and that
 * tc_review writes a tc_complete response back to Pandas inbox (REQ-023 contract).
 */

import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const PROJECT_ROOT = process.cwd();
const SCRIPT = join(PROJECT_ROOT, "scripts/menglan-heartbeat.sh");

async function runBash(
  script: string,
  env: Record<string, string> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", ["-c", script], {
      cwd: PROJECT_ROOT,
      env: {
        HOME: process.env.HOME ?? "/tmp",
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        REPO_ROOT: PROJECT_ROOT,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => { resolve({ code, stdout, stderr }); });
  });
}

/**
 * Create isolated tmpDir with inbox structure + mock scripts/harness.sh.
 * harnessOutput: what the mock prints to stdout (default: empty)
 * harnessExit:   exit code the mock returns (default: 0)
 */
async function setupTmpEnv(tmpDir: string, harnessOutput = "", harnessExit = 0): Promise<void> {
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "scripts"), { recursive: true });

  const mockHarness = join(tmpDir, "scripts", "harness.sh");
  await writeFile(
    mockHarness,
    `#!/usr/bin/env bash\necho "HARNESS_CALLED $@" >> "${tmpDir}/harness_calls.log"\necho '${harnessOutput}'\nexit ${harnessExit}\n`,
    "utf8",
  );
  await chmod(mockHarness, 0o755);
}

// ── BUG-004 regression: TC-BUG004-M01a — tc_review APPROVED writes tc_complete success ──

test("TC-BUG004-M01a: menglan tc_review APPROVED → tc_complete(success) in pandas inbox", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m01a-${Date.now()}`);
  await setupTmpEnv(tmpDir, "tc-review: APPROVED");

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-tc-review-req-903.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-903\npr_number: 42\nsummary: TC review for REQ-903\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Must NOT dead-letter
    const failedMd = (await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(failedMd.length, 0, `Should not dead-letter. failed/: ${failedMd.join(", ")}\nstdout: ${result.stdout}`);

    // harness.sh called with tc-review 42
    const harnessLog = await readFile(join(tmpDir, "harness_calls.log"), "utf8").catch(() => "");
    assert.ok(harnessLog.includes("tc-review") && harnessLog.includes("42"),
      `harness.sh should be called with 'tc-review 42'. log: ${harnessLog}`);

    // tc_complete(success) written to pandas inbox
    const pandasFiles = (await readdir(join(tmpDir, "inbox", "for-pandas", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(pandasFiles.length > 0, `tc_complete response should land in pandas inbox. stdout: ${result.stdout}`);

    const msgContent = await readFile(join(tmpDir, "inbox", "for-pandas", "pending", pandasFiles[0]!), "utf8");
    assert.ok(msgContent.includes("legacy_type: tc_complete"), `Should be tc_complete. content:\n${msgContent}`);
    assert.ok(msgContent.includes("status: success"), `Status should be success. content:\n${msgContent}`);
    assert.ok(msgContent.includes("req_id: REQ-903"), `Should reference REQ-903. content:\n${msgContent}`);
    assert.ok(msgContent.includes("pr_number: 42"), `Should include pr_number. content:\n${msgContent}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004 regression: TC-BUG004-M01b — tc_review NEEDS_CHANGES writes tc_complete blocked ──

test("TC-BUG004-M01b: menglan tc_review NEEDS_CHANGES → tc_complete(blocked) in pandas inbox", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m01b-${Date.now()}`);
  await setupTmpEnv(tmpDir, "tc-review: NEEDS_CHANGES missing branch for error path");

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-tc-review-req-904.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-904\npr_number: 43\nsummary: TC review for REQ-904\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Must NOT dead-letter
    const failedMd = (await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(failedMd.length, 0, `Should not dead-letter. failed/: ${failedMd.join(", ")}\nstdout: ${result.stdout}`);

    // tc_complete(blocked) written to pandas inbox
    const pandasFiles = (await readdir(join(tmpDir, "inbox", "for-pandas", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(pandasFiles.length > 0, `tc_complete response should land in pandas inbox. stdout: ${result.stdout}`);

    const msgContent = await readFile(join(tmpDir, "inbox", "for-pandas", "pending", pandasFiles[0]!), "utf8");
    assert.ok(msgContent.includes("legacy_type: tc_complete"), `Should be tc_complete. content:\n${msgContent}`);
    assert.ok(msgContent.includes("status: blocked"), `Status should be blocked. content:\n${msgContent}`);
    assert.ok(msgContent.includes("req_id: REQ-904"), `Should reference REQ-904. content:\n${msgContent}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004 regression: TC-BUG004-M02 — tc_review without pr_number dead-letters ──

test("TC-BUG004-M02: menglan action=tc_review without pr_number routes to failed/ (guard)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m02-${Date.now()}`);
  await setupTmpEnv(tmpDir);

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-tc-review-no-pr.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-903\nsummary: TC review missing pr_number\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const failedFiles = (await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(failedFiles.length > 0, `tc_review without pr_number should land in failed/. stdout: ${result.stdout}`);

    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes("pr_number"), `Should warn about missing pr_number. output: ${combined}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-MENGLAN-M04: iteration field propagated through tc_review → tc_complete ──

test("TC-MENGLAN-M04: tc_review message with iteration=2 propagates iteration=2 in tc_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-menglan-m04-${Date.now()}`);
  await setupTmpEnv(tmpDir, "tc-review: NEEDS_CHANGES missing branch for edge case");

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-26-tc-review-req-911.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-911\npr_number: 77\niteration: 2\nbranch_name: feat/REQ-911\n---\n",
    "utf8",
  );

  try {
    await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const pandasFiles = (await readdir(join(tmpDir, "inbox", "for-pandas", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(pandasFiles.length > 0, "tc_complete should be written to pandas inbox");

    const content = await readFile(join(tmpDir, "inbox", "for-pandas", "pending", pandasFiles[0]!), "utf8");
    assert.ok(
      content.includes("iteration: 2"),
      `tc_complete must carry iteration=2 for Pandas escalation logic. content:\n${content}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004 regression: TC-BUG004-M03 — harness.sh non-zero exit routes to failed/ ──

test("TC-BUG004-M03: menglan tc_review harness.sh non-zero exit routes to failed/, not tc_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m03-${Date.now()}`);
  // Mock exits 7 (simulates gh auth failure / invalid PR / Claude crash)
  await setupTmpEnv(tmpDir, "tc-review: NEEDS_CHANGES would fool you", 7);

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-tc-review-fail.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-905\npr_number: 99\nsummary: TC review that will fail\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Message MUST land in failed/ — not silently converted to tc_complete
    const failedFiles = (await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(
      failedFiles.length > 0,
      `harness.sh non-zero exit should route to failed/. stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    // Pandas inbox must NOT contain a tc_complete response
    const pandasFiles = (await readdir(join(tmpDir, "inbox", "for-pandas", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    for (const f of pandasFiles) {
      const content = await readFile(join(tmpDir, "inbox", "for-pandas", "pending", f), "utf8");
      assert.ok(
        !content.includes("legacy_type: tc_complete"),
        `Pandas inbox must not contain tc_complete on worker failure. Found:\n${content}`,
      );
    }

    // Log must mention worker failure, not TC feedback
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("worker failure") || combined.includes("exited 7") || combined.includes("exited"),
      `Should log worker failure. output: ${combined}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-MENGLAN-M05: implement success → code_review dispatched to Huahua ──

test("TC-MENGLAN-M05: implement success + gh pr list returns PR 74 → code_review in for-huahua/pending/", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-menglan-m05-${Date.now()}`);
  await setupTmpEnv(tmpDir, "", 0);
  // Create for-huahua inbox directories
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });

  const msgFile = join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-26-implement-req-940.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: implement\nreq_id: REQ-940\nbranch_name: feat/REQ-940\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      // source script so bash function mocks work; then call _process_message directly
      `gh() {
         if [[ "$*" == *"pr list"* ]]; then
           echo "74"
         fi
         return 0
       }
       export -f gh
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       gh() {
         if [[ "$*" == *"pr list"* ]]; then
           echo "74"
         fi
         return 0
       }
       export -f gh
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // code_review message written to for-huahua/pending/
    const huahuaFiles = (await readdir(join(tmpDir, "inbox", "for-huahua", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(huahuaFiles.length > 0, `code_review should be dispatched to for-huahua/pending/. stdout: ${result.stdout}`);

    const content = await readFile(join(tmpDir, "inbox", "for-huahua", "pending", huahuaFiles[0]!), "utf8");
    assert.ok(content.includes("action: code_review"), `Message should have action: code_review. content:\n${content}`);
    assert.ok(content.includes("pr_number: 74"), `Message should carry pr_number: 74. content:\n${content}`);
    assert.ok(content.includes("iteration: 0"), `Message should carry iteration: 0. content:\n${content}`);
    assert.ok(content.includes("req_id: REQ-940"), `Message should carry req_id: REQ-940. content:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-MENGLAN-M06: fix_review → harness fix-review → code_review re-dispatched ──

test("TC-MENGLAN-M06: fix_review message (pr=74, iter=1) + harness exits 0 → code_review in for-huahua/pending/ with iteration=1", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-menglan-m06-${Date.now()}`);
  await setupTmpEnv(tmpDir, "", 0);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });

  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-26-fix-review-req-941.md"),
    "---\ntype: request\naction: fix_review\nreq_id: REQ-941\npr_number: 74\niteration: 1\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Must not dead-letter
    const failedMd = (await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(failedMd.length, 0, `Should not dead-letter. failed/: ${failedMd.join(", ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // code_review message written to for-huahua/pending/ with iteration=1
    const huahuaFiles = (await readdir(join(tmpDir, "inbox", "for-huahua", "pending")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(huahuaFiles.length > 0, `code_review should be dispatched to for-huahua/pending/. stdout: ${result.stdout}`);

    const content = await readFile(join(tmpDir, "inbox", "for-huahua", "pending", huahuaFiles[0]!), "utf8");
    assert.ok(content.includes("action: code_review"), `Message should have action: code_review. content:\n${content}`);
    assert.ok(content.includes("pr_number: 74"), `Message should carry pr_number: 74. content:\n${content}`);
    assert.ok(content.includes("iteration: 1"), `Message should carry iteration: 1. content:\n${content}`);
    assert.ok(content.includes("req_id: REQ-941"), `Message should carry req_id: REQ-941. content:\n${content}`);

    // harness called with fix-review 74
    const harnessLog = await readFile(join(tmpDir, "harness_calls.log"), "utf8").catch(() => "");
    assert.ok(harnessLog.includes("fix-review") && harnessLog.includes("74"),
      `harness.sh should be called with 'fix-review 74'. log: ${harnessLog}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
