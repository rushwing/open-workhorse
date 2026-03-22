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
 * harnessOutput: what the mock harness.sh prints to stdout (default: empty)
 */
async function setupTmpEnv(tmpDir: string, harnessOutput = ""): Promise<void> {
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "scripts"), { recursive: true });

  const mockHarness = join(tmpDir, "scripts", "harness.sh");
  await writeFile(
    mockHarness,
    `#!/usr/bin/env bash\necho "HARNESS_CALLED $@" >> "${tmpDir}/harness_calls.log"\necho '${harnessOutput}'\nexit 0\n`,
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
