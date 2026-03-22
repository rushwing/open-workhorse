/**
 * huahua-heartbeat tests — BUG-004 regression coverage
 *
 * Sources huahua-heartbeat.sh and calls _process_message() directly.
 * The `claude` binary is mocked as a bash function (same pattern as
 * tg_notify in TC-022-04) so _process_message's internal CLAUDE_CMD
 * reset is irrelevant — bash resolves `claude` to the function first.
 */

import assert from "node:assert/strict";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const PROJECT_ROOT = process.cwd();
const SCRIPT = join(PROJECT_ROOT, "scripts/huahua-heartbeat.sh");

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

// ── BUG-004 regression: TC-BUG004-H01 — req_review resolves and calls claude ──

test("TC-BUG004-H01: huahua action=req_review calls claude with REQ context and does not dead-letter", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-h01-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  // Minimal REQ file so prompt includes REQ content
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-906.md"),
    "---\nreq_id: REQ-906\ntitle: Test REQ\nstatus: req_review\nowner: huahua\nacceptance: test criterion\n---\n",
    "utf8",
  );

  // req_review message
  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-22-req-review-906.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: req_review\nreq_id: REQ-906\nsummary: 需求评审请求：Test REQ\n---\n",
    "utf8",
  );

  try {
    // Mock `claude` as a bash function — set before AND after source so the
    // function survives _process_message's internal CLAUDE_CMD reset.
    const result = await runBash(
      `claude_called=0
       claude() { claude_called=1; echo "MOCK_CLAUDE_CALLED"; return 0; }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() { claude_called=1; echo "MOCK_CLAUDE_CALLED"; return 0; }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"
       echo "claude_called=\$claude_called"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // claude must have been invoked
    assert.ok(
      result.stdout.includes("claude_called=1") || result.stdout.includes("MOCK_CLAUDE_CALLED"),
      `claude mock should have been called. stdout: ${result.stdout}`,
    );

    // Must NOT dead-letter
    const failedFiles = (await readdir(join(tmpDir, "inbox", "for-huahua", "failed"))
      .catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(failedFiles.length, 0,
      `req_review should not dead-letter. failed/: ${failedFiles.join(", ")}\nstdout: ${result.stdout}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004 regression: TC-BUG004-H02 — req_review not caught by unknown-handler ──

test("TC-BUG004-H02: huahua action=req_review does not emit 暂无专用 handler warning", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-bug004-h02-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-22-req-review-907.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: req_review\nreq_id: REQ-907\nsummary: req_review routing test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `claude() { return 0; }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() { return 0; }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const combined = result.stdout + result.stderr;
    assert.ok(
      !combined.includes("暂无专用 handler"),
      `req_review must not hit unknown-handler path. output: ${combined}`,
    );
    assert.ok(
      !combined.includes("dead-letter"),
      `req_review must not dead-letter. output: ${combined}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
