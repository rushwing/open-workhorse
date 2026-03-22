/**
 * menglan-heartbeat tests — BUG-004 regression coverage
 *
 * Runs menglan-heartbeat.sh in a tmpdir-isolated environment via bash subprocesses.
 * Tests ATM action routing to verify no valid action dead-letters.
 */

import assert from "node:assert/strict";
import { chmod, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const PROJECT_ROOT = process.cwd();
const SCRIPT = join(PROJECT_ROOT, "scripts/menglan-heartbeat.sh");

/** Run a bash snippet in an isolated tmpdir environment. */
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

/** Create an isolated tmpDir with inbox structure + mock scripts/harness.sh */
async function setupTmpEnv(tmpDir: string): Promise<void> {
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "scripts"), { recursive: true });

  // Mock harness.sh: records the call arguments and exits 0
  const mockHarness = join(tmpDir, "scripts", "harness.sh");
  await writeFile(
    mockHarness,
    `#!/usr/bin/env bash\necho "HARNESS_CALLED $@" >> "${tmpDir}/harness_calls.log"\nexit 0\n`,
    "utf8",
  );
  await chmod(mockHarness, 0o755);
}

// ── BUG-004 regression: TC-BUG004-M01 — tc_review action routes to harness tc-review ──

test("TC-BUG004-M01: menglan action=tc_review with pr_number routes to harness.sh tc-review, not dead-letter", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m01-${Date.now()}`);
  await setupTmpEnv(tmpDir);

  // tc_review message with pr_number
  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-huahua-tc-review-req-903.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-903\npr_number: 42\nsummary: TC review for REQ-903\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Message must NOT end up in failed/
    const failedFiles = await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[]);
    const failedMd = failedFiles.filter((f) => f.endsWith(".md"));
    assert.equal(
      failedMd.length,
      0,
      `tc_review message should not dead-letter. failed/: ${failedMd.join(", ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    // No failure notice must land in pandas inbox
    const pandasFiles = await readdir(join(tmpDir, "inbox", "for-pandas", "pending")).catch(() => [] as string[]);
    const pandasMd = pandasFiles.filter((f) => f.endsWith(".md"));
    assert.equal(
      pandasMd.length,
      0,
      `No failure notice should be sent to pandas inbox. Found: ${pandasMd.join(", ")}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    // harness.sh must have been called with tc-review and the pr_number
    const harnessLog = await readFile(join(tmpDir, "harness_calls.log"), "utf8").catch(() => "");
    assert.ok(
      harnessLog.includes("tc-review") && harnessLog.includes("42"),
      `harness.sh should be called with 'tc-review 42'. log: ${harnessLog}\nstdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004 regression: TC-BUG004-M02 — tc_review without pr_number dead-letters ──

test("TC-BUG004-M02: menglan action=tc_review without pr_number routes to failed/ (guard)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-m02-${Date.now()}`);
  await setupTmpEnv(tmpDir);

  // tc_review message WITHOUT pr_number — should fail gracefully
  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "2026-03-22-huahua-tc-review-no-pr.md"),
    "---\ntype: request\naction: tc_review\nreq_id: REQ-903\nsummary: TC review missing pr_number\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" bash "${SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Message must end up in failed/ (missing required pr_number)
    const failedFiles = await readdir(join(tmpDir, "inbox", "for-menglan", "failed")).catch(() => [] as string[]);
    const failedMd = failedFiles.filter((f) => f.endsWith(".md"));
    assert.ok(
      failedMd.length > 0,
      `tc_review without pr_number should land in failed/. stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    // stdout/stderr must contain the guard warn
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes("pr_number"),
      `Should warn about missing pr_number. output: ${combined}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
