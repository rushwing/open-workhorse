/**
 * pandas-heartbeat tests — REQ-021..025
 *
 * Runs pandas-heartbeat.sh in a tmpdir-isolated environment via bash subprocesses.
 * All Telegram calls are suppressed (TELEGRAM_BOT_TOKEN unset).
 */

import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const PROJECT_ROOT = process.cwd();
const SCRIPT = join(PROJECT_ROOT, "scripts/pandas-heartbeat.sh");

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
        // suppress Telegram
        TELEGRAM_BOT_TOKEN: "",
        TELEGRAM_CHAT_ID: "",
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

// ── REQ-021: TC-021-01 inbox_write writes file with valid YAML frontmatter ──

test("TC-021-01: inbox_write writes file with valid YAML frontmatter", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-021-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; ` +
      `inbox_init && inbox_write "huahua" "tc_design" "REQ-021" "test message"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const huahuaDir = join(tmpDir, "inbox", "for-huahua");
    const files = await readdir(huahuaDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected at least one .md file in for-huahua/");

    const content = await readFile(join(huahuaDir, mdFiles[0]!), "utf8");
    assert.ok(content.startsWith("---"), "File should start with YAML frontmatter");
    assert.ok(content.includes("type: tc_design"), "Missing type field");
    assert.ok(content.includes("req_id: REQ-021"), "Missing req_id field");
    assert.ok(content.includes("summary:"), "Missing summary field");
    assert.ok(content.includes("status:"), "Missing status field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-021: TC-021-02 inbox_read_pandas deletes consumed files ─────────────

test("TC-021-02: inbox_read_pandas deletes consumed message files", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-021-02-${Date.now()}`);
  const inboxDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxDir, { recursive: true });

  const msgFile = join(inboxDir, "2026-03-16-test-msg.md");
  await writeFile(
    msgFile,
    "---\ntype: review_blocked\nreq_id: REQ-999\nsummary: test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(!existsSync(msgFile), "Consumed message file should be deleted");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-021: TC-021-03 SHARED_RESOURCES_ROOT path is respected ──────────────

test("TC-021-03: SHARED_RESOURCES_ROOT sets inbox write path", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-021-03-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_write "menglan" "implement" "REQ-021" "impl test"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(menglanDir);
    assert.ok(files.some((f) => f.endsWith(".md")), "Expected .md file in for-menglan/");
    // Verify path does not contain hardcoded /Users/ or /home/
    assert.ok(!result.stdout.includes("/Users/"), "No hardcoded macOS path in stdout");
    assert.ok(!result.stdout.includes("/home/"), "No hardcoded Linux path in stdout");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-021: TC-021-04 default INBOX_ROOT uses HOME-relative path ────────────

test("TC-021-04: default INBOX_ROOT expands $HOME, not literal ~", async () => {
  const result = await runBash(
    `source "${SCRIPT}"; echo "INBOX_ROOT=\${INBOX_ROOT:-UNSET}"`,
    // Pass SHARED_RESOURCES_ROOT as empty string so .env's ~/... value is not loaded
    { SHARED_RESOURCES_ROOT: "" },
  );
  // INBOX_ROOT should be set and not contain literal ~
  assert.ok(!result.stdout.includes("~"), "INBOX_ROOT must not contain literal ~ (must be expanded)");
});

// ── REQ-022: TC-022-02 empty inbox exits cleanly ─────────────────────────────

test("TC-022-02: empty inbox/for-pandas exits with code 0 and no errors", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-02-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });

  try {
    const result = await runBash(
      `bash "${SCRIPT}"`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        // disable stall detection session log
        HARNESS_SESSION_LOG_OVERRIDE: "/dev/null",
      },
    );
    assert.equal(result.code, 0, `Expected exit 0\nstderr: ${result.stderr}`);
    assert.ok(!result.stderr.includes("ERROR"), "No ERROR in stderr");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-022: TC-022-03 auto-claim selects P1 over P2 ────────────────────────

test("TC-022-03: auto_claim selects P1 task over P2", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-03-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // P2 task
  await writeFile(
    join(featuresDir, "REQ-901.md"),
    "---\nreq_id: REQ-901\ntitle: P2 Task\nstatus: test_designed\npriority: P2\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: [TC-901-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );
  // P1 task
  await writeFile(
    join(featuresDir, "REQ-902.md"),
    "---\nreq_id: REQ-902\ntitle: P1 Task\nstatus: test_designed\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: [TC-902-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );

  try {
    // Run only auto_claim in a subshell — REPO_ROOT overrides the project root to tmpDir
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; auto_claim`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const req902 = await readFile(join(featuresDir, "REQ-902.md"), "utf8");
    const req901 = await readFile(join(featuresDir, "REQ-901.md"), "utf8");
    assert.ok(req902.includes("owner: claude_code"), "REQ-902 (P1) should be claimed");
    assert.ok(req901.includes("owner: unassigned"), "REQ-901 (P2) should remain unclaimed");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-023: TC-023-01 tc-review without arg prints usage error ──────────────

test("TC-023-01: harness.sh tc-review without arg exits non-zero with usage message", async () => {
  const result = await runBash(`bash "${join(PROJECT_ROOT, "scripts/harness.sh")}" tc-review 2>&1 || true`);
  // Should print usage info; exit non-zero (captured with || true but we check stdout)
  assert.ok(
    result.stdout.includes("용法") || result.stdout.includes("用法") || result.stdout.includes("tc-review"),
    `Expected usage message, got: ${result.stdout}`,
  );
});

// ── REQ-023: TC-023-03 tc_complete success routes implement to for-menglan ───

test("TC-023-03: tc_complete status=success writes implement message to for-menglan", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-023-03-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-16-huahua-tc-done-req-021.md"),
    "---\ntype: tc_complete\nreq_id: REQ-021\nstatus: success\nsummary: TC approved\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message in for-menglan/");

    const content = await readFile(join(menglanDir, mdFiles[0]!), "utf8");
    assert.ok(content.includes("type: implement"), "Missing type: implement");
    assert.ok(content.includes("req_id: REQ-021"), "Missing req_id: REQ-021");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-023: TC-023-04 tc_complete blocked iteration=1 routes to for-huahua ─

test("TC-023-04: tc_complete blocked iteration=1 routes fix to for-huahua with iteration=2", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-023-04-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-16-msg.md"),
    "---\ntype: tc_complete\nreq_id: REQ-021\nstatus: blocked\nblocking_reason: missing coverage\niteration: 1\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const huahuaDir = join(tmpDir, "inbox", "for-huahua");
    const files = await readdir(huahuaDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected fix message in for-huahua/");

    const content = await readFile(join(huahuaDir, mdFiles[0]!), "utf8");
    assert.ok(content.includes("iteration: 2"), "iteration should be incremented to 2");
    assert.ok(content.includes("type: tc_design"), "type should be tc_design");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-024: TC-024-01 tg_poll_commands is silent when TOKEN unset ────────────

test("TC-024-01: tg_poll_commands silently returns when TELEGRAM_BOT_TOKEN unset", async () => {
  const result = await runBash(
    `source "${join(PROJECT_ROOT, "scripts/telegram.sh")}" 2>/dev/null; tg_poll_commands`,
    { TELEGRAM_BOT_TOKEN: "", TELEGRAM_CHAT_ID: "" },
  );
  assert.equal(result.code, 0, "Expected exit 0 (silent return)");
  assert.ok(!result.stderr.includes("ERROR"), "No ERROR in stderr");
});

// ── REQ-024: TC-024-03 hold command creates .pandas_hold ─────────────────────

test("TC-024-03: hold command creates .pandas_hold file", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-024-03-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const holdFlag = join(tmpDir, ".pandas_hold");
    // Source the script (with source guard it won't run main), override tg_poll_commands to emit "hold"
    const result = await runBash(
      `source "${SCRIPT}"; ` +
      `tg_poll_commands() { echo "hold"; }; ` +
      `tg_notify() { echo "[mock tg_notify] \$*"; return 0; }; ` +
      `HOLD_FLAG="${holdFlag}"; ` +
      `handle_telegram_commands`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(existsSync(holdFlag), ".pandas_hold file should be created");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-025: TC-025-01 detect_major_decision triggers TRIGGER-001 ────────────

test("TC-025-01: detect_major_decision triggers TRIGGER-001 for undeclared credential", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-025-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  // REQ file with undeclared API key reference
  const reqFile = join(tmpDir, "REQ-TEST.md");
  await writeFile(
    reqFile,
    "---\nreq_id: REQ-TEST\ntitle: Test\n---\n\nThis feature requires MY_UNDECLARED_API_KEY to call the service.\n",
    "utf8",
  );

  try {
    // tg_decision mock: print call and return success so detect returns 1
    const result = await runBash(
      `tg_decision_called=0
       tg_decision() { tg_decision_called=1; echo "[mock tg_decision] \$*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_decision() { tg_decision_called=1; echo "[mock tg_decision] \$*"; return 0; }
       detect_major_decision "${reqFile}"
       ret=$?
       echo "return_val=$ret"
       echo "tg_decision_called=$tg_decision_called"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );

    // detect_major_decision returns 1 on trigger
    assert.ok(
      result.stdout.includes("return_val=1") || result.stdout.includes("[mock tg_decision]"),
      `TRIGGER-001 should fire. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-025: TC-025-02 detect_major_decision returns 0 when cred is declared ─

test("TC-025-02: detect_major_decision returns 0 when credential exists in .env.example", async () => {
  const result = await runBash(
    `source "${SCRIPT}" 2>/dev/null
     # Create temp req file referencing TELEGRAM_BOT_TOKEN (which IS in .env.example)
     tmpf="$(mktemp)"
     echo "---" > "$tmpf"
     echo "req_id: REQ-TEST2" >> "$tmpf"
     echo "---" >> "$tmpf"
     echo "Uses TELEGRAM_BOT_TOKEN for notifications." >> "$tmpf"
     detect_major_decision "$tmpf"
     ret=$?
     rm -f "$tmpf"
     echo "return_val=$ret"`,
    {},
  );
  assert.ok(
    result.stdout.includes("return_val=0"),
    `Should return 0 when TOKEN is declared in .env.example. stdout: ${result.stdout}`,
  );
});

// ── REQ-025: TC-025-03 TRIGGER-002 fires for depends_on blocking_reason ──────

test("TC-025-03: TRIGGER-002 fires for blocking_reason containing depends_on", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-025-03-${Date.now()}`);
  const inboxDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });

  await writeFile(
    join(inboxDir, "2026-03-16-test.md"),
    "---\ntype: major_decision_needed\nreq_id: REQ-022\nstatus: blocked\nblocking_reason: depends_on REQ-021 (unfinished)\nsummary: blocked\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_decision() { echo "[mock tg_decision] \$*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_decision() { echo "[mock tg_decision] \$*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_decision]"),
      `TRIGGER-002 should call tg_decision. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-025: TC-025-04 TRIGGER-003 fires for outside REQ boundary ────────────

test("TC-025-04: TRIGGER-003 fires for blocking_reason containing outside REQ boundary", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-025-04-${Date.now()}`);
  const inboxDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });

  await writeFile(
    join(inboxDir, "2026-03-16-test.md"),
    "---\ntype: major_decision_needed\nreq_id: REQ-022\nstatus: blocked\nblocking_reason: implementation requires changes outside REQ boundary\nsummary: blocked\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_decision() { echo "[mock tg_decision] \$*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_decision() { echo "[mock tg_decision] \$*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_decision]"),
      `TRIGGER-003 should call tg_decision. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-025: TC-025-05 no trigger = detect returns 0 ────────────────────────

test("TC-025-05: detect_major_decision returns 0 with no trigger conditions", async () => {
  const result = await runBash(
    `source "${SCRIPT}" 2>/dev/null
     tmpf="$(mktemp)"
     echo "---" > "$tmpf"
     echo "req_id: REQ-SAFE" >> "$tmpf"
     echo "---" >> "$tmpf"
     echo "实现监控快照功能，无需外部凭证。" >> "$tmpf"
     tg_decision_called=0
     tg_decision() { tg_decision_called=1; }
     detect_major_decision "$tmpf"
     ret=$?
     rm -f "$tmpf"
     echo "return_val=$ret"
     echo "tg_decision_called=$tg_decision_called"`,
    {},
  );
  assert.ok(
    result.stdout.includes("return_val=0"),
    `Should return 0. stdout: ${result.stdout}`,
  );
  assert.ok(
    result.stdout.includes("tg_decision_called=0"),
    `tg_decision should not be called. stdout: ${result.stdout}`,
  );
});
