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

// ── TC-HUAHUA-H03: req_review prompt includes git push before gh pr create ──

test("TC-HUAHUA-H03: req_review prompt includes git push step before gh pr create", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h03-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-908.md"),
    "---\nreq_id: REQ-908\ntitle: Push Test REQ\nstatus: req_review\nowner: huahua\nacceptance: x\n---\n",
    "utf8",
  );

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-req-review-908.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: req_review\nreq_id: REQ-908\nsummary: review request\n---\n",
    "utf8",
  );

  const promptCapture = join(tmpDir, "claude_prompt.txt");

  try {
    await runBash(
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
    const prIdx = prompt.indexOf("gh pr create");
    assert.ok(
      pushIdx !== -1 && prIdx !== -1 && pushIdx < prIdx,
      `git push must appear before gh pr create (push@${pushIdx}, pr-create@${prIdx})`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H04: req_review PASSED does not write back to for-pandas ───────

test("TC-HUAHUA-H04: req_review PASSED does not write to for-pandas inbox", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h04-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-909.md"),
    "---\nreq_id: REQ-909\ntitle: No Pandas Writeback REQ\nstatus: req_review\nowner: huahua\nacceptance: x\n---\n",
    "utf8",
  );

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-req-review-909.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: req_review\nreq_id: REQ-909\nsummary: review request\n---\n",
    "utf8",
  );

  try {
    await runBash(
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

// ── TC-HUAHUA-H05: tc_design fix-review re-dispatches tc_review to Menglan ──

test("TC-HUAHUA-H05: tc_design fix iteration re-dispatches tc_review to for-menglan after successful fix-review", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h05-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  // tc_design fix message (pr_number set → fix-review path)
  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-tc-design-fix-REQ-910.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: tc_design\nreq_id: REQ-910\npr_number: 99\nblocking_reason: missing-branch\niteration: 1\n---\n",
    "utf8",
  );

  // Fake harness.sh that exits 0 for fix-review
  const fakeHarness = join(tmpDir, "scripts", "harness.sh");
  await mkdir(join(tmpDir, "scripts"), { recursive: true });
  await writeFile(fakeHarness, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await runBash(`chmod +x "${fakeHarness}"`);

  try {
    const result = await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanFiles = await readdir(join(tmpDir, "inbox", "for-menglan", "pending"))
      .catch(() => [] as string[]);
    const tcReviewMsg = menglanFiles.find((f) => f.endsWith(".md"));
    assert.ok(tcReviewMsg,
      `tc_design fix must re-dispatch tc_review to for-menglan. stdout: ${result.stdout}`);

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpDir, "inbox", "for-menglan", "pending", tcReviewMsg!),
      "utf8",
    );
    assert.ok(content.includes("action: tc_review"),
      `re-dispatched message must have action: tc_review. content: ${content}`);
    assert.ok(content.includes("REQ-910"),
      `re-dispatched message must reference REQ-910. content: ${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H06: tc_design fix carries iteration into re-dispatched tc_review ──

test("TC-HUAHUA-H06: tc_design fix with iteration=1 writes tc_review to for-menglan with iteration=1", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h06-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-tc-design-fix-REQ-912.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: tc_design\nreq_id: REQ-912\npr_number: 88\nblocking_reason: missing-branch\niteration: 1\n---\n",
    "utf8",
  );

  const fakeHarness = join(tmpDir, "scripts", "harness.sh");
  await mkdir(join(tmpDir, "scripts"), { recursive: true });
  await writeFile(fakeHarness, "#!/usr/bin/env bash\nexit 0\n", "utf8");
  await runBash(`chmod +x "${fakeHarness}"`);

  try {
    await runBash(
      `SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    const menglanFiles = await readdir(join(tmpDir, "inbox", "for-menglan", "pending"))
      .catch(() => [] as string[]);
    const tcReviewMsg = menglanFiles.find((f) => f.endsWith(".md"));
    assert.ok(tcReviewMsg, "tc_design fix must re-dispatch tc_review to for-menglan");

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(
      join(tmpDir, "inbox", "for-menglan", "pending", tcReviewMsg!),
      "utf8",
    );
    assert.ok(
      content.includes("iteration: 1"),
      `re-dispatched tc_review must carry iteration=1 for escalation counter. content: ${content}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H07: code_review NEEDS_CHANGES (iter=0) → fix_review to Menglan ──

test("TC-HUAHUA-H07: code_review NEEDS_CHANGES (iter=0) → fix_review in for-menglan/pending/ with iteration=1; for-pandas empty", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h07-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-code-review-REQ-950.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: code_review\nreq_id: REQ-950\npr_number: 74\niteration: 0\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      // gh mock: return a non-empty diff for pr diff; claude mock: return NEEDS_CHANGES
      `gh() {
         if [[ "$*" == *"pr diff"* ]]; then
           echo "diff --git a/src/foo.ts b/src/foo.ts"
         fi
         return 0
       }
       export -f gh
       claude() {
         echo '{"structured_output":{"verdict":"NEEDS_CHANGES","summary":"missing tests"}}'
         return 0
       }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       gh() {
         if [[ "$*" == *"pr diff"* ]]; then
           echo "diff --git a/src/foo.ts b/src/foo.ts"
         fi
         return 0
       }
       export -f gh
       claude() {
         echo '{"structured_output":{"verdict":"NEEDS_CHANGES","summary":"missing tests"}}'
         return 0
       }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // fix_review should land in for-menglan/pending/ with iteration=1
    const { readFile } = await import("node:fs/promises");
    const menglanFiles = (await readdir(join(tmpDir, "inbox", "for-menglan", "pending"))
      .catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.ok(menglanFiles.length > 0,
      `fix_review should be dispatched to for-menglan/pending/. stdout: ${result.stdout}`);

    const content = await readFile(join(tmpDir, "inbox", "for-menglan", "pending", menglanFiles[0]!), "utf8");
    assert.ok(content.includes("action: fix_review"),
      `Message should have action: fix_review. content:\n${content}`);
    assert.ok(content.includes("iteration: 1"),
      `Message should carry iteration=1 (0+1). content:\n${content}`);
    assert.ok(content.includes("pr_number: 74"),
      `Message should carry pr_number: 74. content:\n${content}`);
    assert.ok(content.includes("req_id: REQ-950"),
      `Message should carry req_id: REQ-950. content:\n${content}`);

    // for-pandas/pending/ must remain empty
    const pandasFiles = (await readdir(join(tmpDir, "inbox", "for-pandas", "pending"))
      .catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(pandasFiles.length, 0,
      `for-pandas must be empty on NEEDS_CHANGES (direct loop). found: ${pandasFiles.join(", ")}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H08: code_review NEEDS_CHANGES (iter=2) → tg_decision, no fix_review ──

test("TC-HUAHUA-H08: code_review NEEDS_CHANGES (iter=2) → tg_decision called, no fix_review in for-menglan", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h08-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });

  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-26-code-review-REQ-951.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: code_review\nreq_id: REQ-951\npr_number: 75\niteration: 2\n---\n",
    "utf8",
  );

  const tgMarker = join(tmpDir, "tg_decision_called");

  try {
    const result = await runBash(
      `gh() {
         if [[ "$*" == *"pr diff"* ]]; then
           echo "diff --git a/src/bar.ts b/src/bar.ts"
         fi
         return 0
       }
       export -f gh
       claude() {
         echo '{"structured_output":{"verdict":"NEEDS_CHANGES","summary":"still broken"}}'
         return 0
       }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       gh() {
         if [[ "$*" == *"pr diff"* ]]; then
           echo "diff --git a/src/bar.ts b/src/bar.ts"
         fi
         return 0
       }
       export -f gh
       claude() {
         echo '{"structured_output":{"verdict":"NEEDS_CHANGES","summary":"still broken"}}'
         return 0
       }
       export -f claude
       tg_decision() { touch "${tgMarker}"; return 0; }
       export -f tg_decision
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // tg_decision must have been called
    const tgCalled = await access(tgMarker).then(() => true).catch(() => false);
    assert.ok(tgCalled,
      `tg_decision must be called when iter≥2. stdout: ${result.stdout}`);

    // No fix_review in for-menglan
    const menglanFiles = (await readdir(join(tmpDir, "inbox", "for-menglan", "pending"))
      .catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    assert.equal(menglanFiles.length, 0,
      `fix_review must NOT be dispatched when iter≥2. found: ${menglanFiles.join(", ")}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H09: tc_design initial (Telegram-triggered, no pr_number) ──────
// Regression for PR #76 P1: initial path was dead-lettered; re-opened but must
// dispatch tc_review to Menglan and prompt must correct owner to unassigned.

test("TC-HUAHUA-H09: tc_design without pr_number (Telegram-triggered initial) dispatches tc_review to for-menglan and prompt corrects owner to unassigned", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-huahua-h09-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });

  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-920.md"),
    "---\nreq_id: REQ-920\ntitle: Telegram Triggered TC Design\nstatus: in_progress\nowner: claude_code\nacceptance: x\n---\n",
    "utf8",
  );

  // tc_design message WITHOUT pr_number (Telegram-triggered initial path)
  const msgFile = join(tmpDir, "inbox", "for-huahua", "pending", "2026-03-27-tc-design-initial-REQ-920.md");
  await writeFile(
    msgFile,
    "---\ntype: request\naction: tc_design\nreq_id: REQ-920\nsummary: TC design request (Telegram)\n---\n",
    "utf8",
  );

  const promptCapture = join(tmpDir, "claude_prompt.txt");

  try {
    const result = await runBash(
      `claude() {
         printf '%s' "$*" > "${promptCapture}"
         echo '{"structured_output":{"tc_pr_number":"55"}}'
         return 0
       }
       export -f claude
       SHARED_RESOURCES_ROOT="${tmpDir}" REPO_ROOT="${tmpDir}" \
         source "${SCRIPT}" 2>/dev/null
       claude() {
         printf '%s' "$*" > "${promptCapture}"
         echo '{"structured_output":{"tc_pr_number":"55"}}'
         return 0
       }
       export -f claude
       INBOX_ROOT="${tmpDir}/inbox"
       _process_message "${msgFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0,
      `_process_message should succeed. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Must dispatch tc_review to for-menglan
    const menglanFiles = await readdir(join(tmpDir, "inbox", "for-menglan", "pending"))
      .catch(() => [] as string[]);
    const tcReviewMsg = menglanFiles.find((f) => f.endsWith(".md"));
    assert.ok(tcReviewMsg,
      `tc_design initial must dispatch tc_review to for-menglan. stdout: ${result.stdout}`);

    const { readFile } = await import("node:fs/promises");
    const msgContent = await readFile(
      join(tmpDir, "inbox", "for-menglan", "pending", tcReviewMsg!),
      "utf8",
    );
    assert.ok(msgContent.includes("action: tc_review"),
      `dispatched message must have action: tc_review. content: ${msgContent}`);
    assert.ok(msgContent.includes("REQ-920"),
      `dispatched message must reference REQ-920. content: ${msgContent}`);
    assert.ok(msgContent.includes("pr_number: 55"),
      `dispatched message must carry tc_pr_number=55. content: ${msgContent}`);

    // Prompt must instruct correcting owner to unassigned
    const prompt = await readFile(promptCapture, "utf8").catch(() => "");
    assert.ok(
      prompt.includes("owner") && prompt.includes("unassigned"),
      `tc_design initial prompt must instruct owner → unassigned to correct Pandas premature claim. prompt: ${prompt.slice(0, 600)}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-HUAHUA-H10: implement prompt includes git push after pr_number commit ──
// Regression for PR #76 P2: pr_number commit stayed local without push;
// archive_merged_reqs reads from merged remote file so push is required.
// Static text check: cmd_implement has git pre-checks that block dynamic
// invocation outside a real git repo; reading the source is sufficient.

test("TC-HUAHUA-H10: harness.sh cmd_implement prompt source contains git push after pr_number writeback", async () => {
  const { readFile } = await import("node:fs/promises");
  const HARNESS = join(PROJECT_ROOT, "scripts/harness.sh");
  const src = await readFile(HARNESS, "utf8");

  // Find the cmd_implement function body
  const fnStart = src.indexOf("cmd_implement()");
  const fnEnd = src.indexOf("\ncmd_bugfix()", fnStart);
  assert.ok(fnStart !== -1, "cmd_implement function must exist in harness.sh");
  const fnBody = src.slice(fnStart, fnEnd !== -1 ? fnEnd : undefined);

  // pr_number writeback must be present
  assert.ok(
    fnBody.includes("pr_number"),
    `cmd_implement prompt must include pr_number writeback step. snippet: ${fnBody.slice(0, 800)}`,
  );

  // git push must appear after pr_number in the prompt
  const prNumIdx = fnBody.indexOf("pr_number");
  const pushIdx = fnBody.indexOf("git push", prNumIdx);
  assert.ok(
    pushIdx !== -1,
    `cmd_implement prompt must include git push AFTER pr_number writeback. pr_number@${prNumIdx}, git push@${pushIdx}`,
  );
});
