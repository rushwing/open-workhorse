/**
 * huahua-heartbeat tests — BUG-004 regression coverage
 *
 * Sources huahua-heartbeat.sh and calls _process_message() directly.
 * The `claude` binary is mocked as a bash function (same pattern as
 * tg_notify in TC-022-04) so _process_message's internal CLAUDE_CMD
 * reset is irrelevant — bash resolves `claude` to the function first.
 */

import assert from "node:assert/strict";
import { access, mkdir, readdir, rm, writeFile } from "node:fs/promises";
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
    const claudeMarker = join(tmpDir, "claude_was_called");
    const result = await runBash(
      // Mock claude writes a marker file (subshell-safe) and returns valid structured JSON
      `claude() { touch "${claudeMarker}"; echo '{"structured_output":{"verdict":"DEFECTS","summary":"mock test defect"}}'; return 0; }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() { touch "${claudeMarker}"; echo '{"structured_output":{"verdict":"DEFECTS","summary":"mock test defect"}}'; return 0; }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // claude must have been invoked (marker file written by mock)
    const markerExists = await access(claudeMarker).then(() => true).catch(() => false);
    assert.ok(markerExists,
      `claude mock should have been called (marker file missing). stdout: ${result.stdout}`,
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

// ── req_review prompt includes git push before gh pr create ──────────────────

test("TC-HUAHUA-H03: req_review prompt includes git push step before gh pr create", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h03-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  const reqId = "REQ-908";
  await writeFile(
    join(tmpDir, "tasks", "features", `${reqId}.md`),
    `---\nreq_id: ${reqId}\ntitle: Push Test REQ\nstatus: req_review\nowner: huahua\nacceptance: x\n---\n`,
    "utf8",
  );

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", `2026-03-26-req-review-908.md`);
  await writeFile(
    msgFile,
    `---\ntype: request\naction: req_review\nreq_id: ${reqId}\nsummary: review request\n---\n`,
    "utf8",
  );

  const promptCapture = join(tmpDir, "claude_prompt.txt");

  try {
    await runBash(
      // Capture all args passed to claude; return DEFECTS so no further routing needed
      `claude() { printf '%s' "$*" > "${promptCapture}"; echo '{"structured_output":{"verdict":"DEFECTS","summary":"mock"}}'; return 0; }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() { printf '%s' "$*" > "${promptCapture}"; echo '{"structured_output":{"verdict":"DEFECTS","summary":"mock"}}'; return 0; }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}" || true`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const { readFile } = await import("node:fs/promises");
    const prompt = await readFile(promptCapture, "utf8").catch(() => "");

    assert.ok(
      prompt.includes("git push -u origin feat/"),
      `req_review prompt must include git push step. captured prompt: ${prompt.slice(0, 500)}`,
    );

    const pushIdx = prompt.indexOf("git push -u origin feat/");
    const prCreateIdx = prompt.indexOf("gh pr create");
    assert.ok(
      pushIdx !== -1 && prCreateIdx !== -1 && pushIdx < prCreateIdx,
      `git push must appear before gh pr create in prompt (push@${pushIdx}, pr-create@${prCreateIdx})`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── req_review PASSED does not write back to for-pandas ──────────────────────

test("TC-HUAHUA-H04: req_review PASSED does not write req_review_complete to for-pandas", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h04-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  const reqId = "REQ-909";
  await writeFile(
    join(tmpDir, "tasks", "features", `${reqId}.md`),
    `---\nreq_id: ${reqId}\ntitle: No Pandas Writeback REQ\nstatus: req_review\nowner: huahua\nacceptance: x\n---\n`,
    "utf8",
  );

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", `2026-03-26-req-review-909.md`);
  await writeFile(
    msgFile,
    `---\ntype: request\naction: req_review\nreq_id: ${reqId}\nsummary: review request\n---\n`,
    "utf8",
  );

  try {
    await runBash(
      // Return PASSED with a tc_pr_number so the PASSED branch executes
      `claude() { echo '{"structured_output":{"verdict":"PASSED","summary":"ok","tc_pr_number":"42"}}'; return 0; }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() { echo '{"structured_output":{"verdict":"PASSED","summary":"ok","tc_pr_number":"42"}}'; return 0; }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}" || true`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const pandasFiles = await readdir(join(tmpDir, "inbox", "for-pandas", "pending"))
      .catch(() => [] as string[]);

    assert.equal(
      pandasFiles.filter((f) => f.endsWith(".md")).length,
      0,
      `req_review PASSED must not write to for-pandas. found: ${pandasFiles.join(", ")}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});
