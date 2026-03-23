/**
 * pandas-heartbeat tests — REQ-021..025
 *
 * Runs pandas-heartbeat.sh in a tmpdir-isolated environment via bash subprocesses.
 * All Telegram calls are suppressed (TELEGRAM_BOT_TOKEN unset).
 */

import assert from "node:assert/strict";
import { chmod, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

/** Make a file executable (chmod +x). */
async function makeExecutable(filePath: string): Promise<void> {
  await chmod(filePath, 0o755);
}

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
    const files = await readdir(join(huahuaDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected at least one .md file in for-huahua/pending/");

    const content = await readFile(join(huahuaDir, "pending", mdFiles[0]!), "utf8");
    assert.ok(content.startsWith("---"), "File should start with YAML frontmatter");
    // inbox_write() is now a @deprecated wrapper that calls inbox_write_v2(),
    // so output uses ATM Envelope format: type: request + action: tc_design (REQ-033)
    assert.ok(content.includes("type: request") || content.includes("type: tc_design"), "Missing type field");
    assert.ok(content.includes("req_id: REQ-021"), "Missing req_id field");
    assert.ok(content.includes("summary") || content.includes("action:"), "Missing summary/action field");
    assert.ok(content.includes("status") || content.includes("message_id:"), "Missing status/message_id field");
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
    const files = await readdir(join(menglanDir, "pending"));
    assert.ok(files.some((f) => f.endsWith(".md")), "Expected .md file in for-menglan/pending/");
    // Verify path does not contain hardcoded machine-specific home prefixes
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

// Updated: test_designed REQs are no longer claimed by Pandas auto_claim (§8.4).
// Priority selection is tested with ready+tc_policy=optional instead.
test("TC-022-03: auto_claim selects P1 task over P2", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-03-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // P2 task — ready + tc_policy=optional (claimable by Pandas)
  await writeFile(
    join(featuresDir, "REQ-901.md"),
    "---\nreq_id: REQ-901\ntitle: P2 Task\nstatus: ready\npriority: P2\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: optional\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );
  // P1 task — ready + tc_policy=optional (claimable by Pandas)
  await writeFile(
    join(featuresDir, "REQ-902.md"),
    "---\nreq_id: REQ-902\ntitle: P1 Task\nstatus: ready\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: optional\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
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

// ── REQ-022: TC-022-05 test_designed does not block ready+optional claim ──────
// Regression test: when a test_designed REQ coexists with a ready+optional REQ,
// auto_claim must skip the test_designed one and claim the ready+optional one.

test("TC-022-05: auto_claim skips test_designed and claims ready+optional when both present", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-05-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // test_designed item — NOT claimable by Pandas (handled via Huahua→Menglan path)
  await writeFile(
    join(featuresDir, "REQ-903.md"),
    "---\nreq_id: REQ-903\ntitle: TC Designed Task\nstatus: test_designed\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: [TC-903-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );
  // ready+optional item — claimable by Pandas
  await writeFile(
    join(featuresDir, "REQ-904.md"),
    "---\nreq_id: REQ-904\ntitle: Optional Task\nstatus: ready\npriority: P2\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: optional\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; auto_claim`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const req903 = await readFile(join(featuresDir, "REQ-903.md"), "utf8");
    const req904 = await readFile(join(featuresDir, "REQ-904.md"), "utf8");
    // test_designed must not be claimed by Pandas
    assert.ok(req903.includes("owner: unassigned"), "REQ-903 (test_designed) must remain unassigned");
    assert.ok(req903.includes("status: test_designed"), "REQ-903 status must remain test_designed");
    // ready+optional must be claimed
    assert.ok(req904.includes("owner: claude_code"), "REQ-904 (ready+optional) should be claimed");
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
    const files = await readdir(join(menglanDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message in for-menglan/pending/");

    const content = await readFile(join(menglanDir, "pending", mdFiles[0]!), "utf8");
    // inbox_write() is now a @deprecated wrapper → ATM Envelope format: type: request + action: implement
    assert.ok(content.includes("type: request") || content.includes("type: implement"), "Missing type: request/implement");
    assert.ok(content.includes("action: implement") || content.includes("req_id: REQ-021"), "Missing action/req_id");
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
    const files = await readdir(join(huahuaDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected fix message in for-huahua/pending/");

    const content = await readFile(join(huahuaDir, "pending", mdFiles[0]!), "utf8");
    assert.ok(content.includes("iteration: 2"), "iteration should be incremented to 2");
    // inbox_write() is now a @deprecated wrapper → ATM Envelope format: type: request + action: tc_design
    assert.ok(content.includes("type: request") || content.includes("type: tc_design"), "type should be request/tc_design");
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

// ── REQ-022: TC-022-01 APP_COMMAND=pandas-heartbeat is recognised ────────────

test("TC-022-01: APP_COMMAND=pandas-heartbeat is accepted by normalizeCommand (no Unknown command error)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-01-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });

  try {
    const result = await runBash(
      `APP_COMMAND=pandas-heartbeat node --import tsx "${join(PROJECT_ROOT, "src/index.ts")}" 2>&1 || true`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        LOCAL_API_TOKEN: "",
        LOCAL_TOKEN_AUTH_REQUIRED: "false",
      },
    );
    // Should not contain "Unknown command"
    assert.ok(
      !result.stdout.includes("Unknown command"),
      `Should not get 'Unknown command'. stdout: ${result.stdout.slice(0, 500)}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-022: TC-022-04 stall_detection triggers tg_notify for stale task ─────

test("TC-022-04: stall_detection calls tg_notify for stale in_progress task", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-04-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });

  // Create an old harness_sessions log entry (2020 = definitely stale)
  const sessionLog = join(tmpDir, ".harness_sessions");
  await writeFile(sessionLog, "2020-01-01T00:00:00Z implement REQ-999\n", "utf8");

  // Create the in_progress REQ
  await writeFile(
    join(featuresDir, "REQ-999.md"),
    "---\nreq_id: REQ-999\ntitle: Stale Task\nstatus: in_progress\npriority: P1\nphase: phase-2\nowner: claude_code\ndepends_on: []\ntest_case_ref: []\ntc_policy: exempt\ntc_exempt_reason: test\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_notify_called=0
       tg_notify() { tg_notify_called=1; echo "[mock tg_notify] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_notify() { tg_notify_called=1; echo "[mock tg_notify] $*"; return 0; }
       stall_detection
       echo "tg_notify_called=$tg_notify_called"`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        DEV_WATCHDOG_STALE_HOURS: "1",
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_notify]") || result.stdout.includes("tg_notify_called=1"),
      `stall_detection should call tg_notify. stdout: ${result.stdout}`,
    );
    assert.ok(
      result.stdout.includes("REQ-999"),
      `tg_notify message should mention REQ-999. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-023: TC-023-02 tc-review calls Claude with mock claude binary ─────────

test("TC-023-02: harness.sh tc-review calls Claude with TC review prompt", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-023-02-${Date.now()}`);
  const mockBin = join(tmpDir, "bin");
  await mkdir(mockBin, { recursive: true });

  // Mock claude binary
  const mockClaude = join(mockBin, "claude");
  await writeFile(mockClaude, '#!/usr/bin/env bash\necho "CLAUDE_CALLED $@"\nexit 0\n', "utf8");
  await makeExecutable(mockClaude);

  // Mock gh binary
  const mockGh = join(mockBin, "gh");
  await writeFile(
    mockGh,
    `#!/usr/bin/env bash
case "$*" in
  *"repo view"*) echo '{"nameWithOwner":"test-owner/test-repo"}' ;;
  *"pr view"*"--json reviews"*) echo '[]' ;;
  *"pr view"*"--json title"*) echo '{"title":"TC REQ-021 add inbox","headRefName":"tc/REQ-021-inbox"}' ;;
  *"pr view"*"--json files"*) echo '{"files":[]}' ;;
  *"api"*"pulls"*"comments"*) echo '[]' ;;
  *) echo '{}' ;;
esac
exit 0
`,
    "utf8",
  );
  await makeExecutable(mockGh);

  try {
    const result = await runBash(
      `PATH="${mockBin}:$PATH" bash "${join(PROJECT_ROOT, "scripts/harness.sh")}" tc-review 99 2>&1 || true`,
      { REPO_ROOT: PROJECT_ROOT },
    );
    assert.ok(
      result.stdout.includes("CLAUDE_CALLED") || result.stdout.includes("adequate"),
      `Expected Claude to be called with TC review prompt. stdout: ${result.stdout.slice(0, 500)}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-023: TC-023-05 tc_complete blocked iteration=2 triggers tg_decision ──

test("TC-023-05: tc_complete blocked iteration=2 triggers tg_decision, no new huahua message", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-023-05-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  const huahuaDir = join(tmpDir, "inbox", "for-huahua");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(huahuaDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-16-msg.md"),
    "---\ntype: tc_complete\nreq_id: REQ-021\nstatus: blocked\nblocking_reason: still missing coverage\niteration: 2\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_decision() { echo "[mock tg_decision] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_decision() { echo "[mock tg_decision] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_decision]"),
      `tg_decision should be called for iteration≥2. stdout: ${result.stdout}`,
    );
    // for-huahua/pending/ should have no new tc_design files (inbox_init creates subdirs but no messages)
    const huahuaPendingFiles = await readdir(join(huahuaDir, "pending"));
    assert.equal(huahuaPendingFiles.filter(f => f.endsWith(".md")).length, 0,
      `for-huahua/pending/ should have no new .md files, got: ${huahuaPendingFiles.join(", ")}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-024: TC-024-02 start REQ-021 command claims the REQ ──────────────────

test("TC-024-02: Telegram start REQ-021 command claims REQ-021", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-024-02-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-021.md"),
    "---\nreq_id: REQ-021\ntitle: Inbox IPC\nstatus: ready\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: optional\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       tg_notify() { echo "[mock tg_notify] $*"; return 0; }
       tg_poll_commands() { echo "start REQ-021"; }
       handle_telegram_commands`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        TELEGRAM_BOT_TOKEN: "mock",
        TELEGRAM_CHAT_ID: "12345",
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const req021 = await readFile(join(featuresDir, "REQ-021.md"), "utf8");
    assert.ok(req021.includes("owner: claude_code"), `REQ-021 should be claimed. content: ${req021}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-024: TC-024-04 resume command deletes .pandas_hold ───────────────────

test("TC-024-04: resume command deletes .pandas_hold file", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-024-04-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const holdFlag = join(tmpDir, ".pandas_hold");
  // Pre-create the hold file
  await writeFile(holdFlag, "", "utf8");
  assert.ok(existsSync(holdFlag), "Pre-condition: .pandas_hold should exist");

  try {
    const result = await runBash(
      `source "${SCRIPT}";
       tg_poll_commands() { echo "resume"; };
       tg_notify() { echo "[mock tg_notify] $*"; return 0; };
       HOLD_FLAG="${holdFlag}";
       handle_telegram_commands`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(!existsSync(holdFlag), ".pandas_hold file should be deleted after resume");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-024: TC-024-05 tg_decision timeout re-sends notification ─────────────

test("TC-024-05: tg_decision times out and calls tg_notify for re-notification", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-024-05-${Date.now()}`);
  const mockBin = join(tmpDir, "bin");
  await mkdir(mockBin, { recursive: true });

  // Mock curl: sendMessage returns ok:true with message_id; getUpdates returns empty
  const mockCurl = join(mockBin, "curl");
  await writeFile(
    mockCurl,
    `#!/usr/bin/env bash
# Detect endpoint from args
if echo "$@" | grep -q "sendMessage"; then
  echo '{"ok":true,"result":{"message_id":42}}'
elif echo "$@" | grep -q "getUpdates"; then
  echo '{"ok":true,"result":[]}'
elif echo "$@" | grep -q "answerCallbackQuery"; then
  echo '{"ok":true}'
fi
exit 0
`,
    "utf8",
  );
  await makeExecutable(mockCurl);

  try {
    const result = await runBash(
      `PATH="${mockBin}:$PATH"
       source "${join(PROJECT_ROOT, "scripts/telegram.sh")}" 2>/dev/null
       tg_notify() { echo "[mock tg_notify] $*"; return 0; }
       tg_decision "Test decision" "Yes" "No"
       echo "exit_code=$?"`,
      {
        TELEGRAM_BOT_TOKEN: "mock_token",
        TELEGRAM_CHAT_ID: "12345",
        TG_DECISION_TIMEOUT: "1",
      },
    );
    // Should time out (non-zero exit) and mention "decision timed out"
    assert.ok(
      result.stderr.includes("decision timed out") || result.stdout.includes("decision timed out"),
      `Expected 'decision timed out'. stderr: ${result.stderr.slice(0, 300)} stdout: ${result.stdout.slice(0, 300)}`,
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

// ── REQ-033: TC-033-01 inbox_write_v2 generates ATM Envelope ─────────────────

test("TC-033-01: inbox_write_v2 generates file with all required ATM Envelope fields", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_REQ033_1" "corr_REQ033_1" "" "P1" "true" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(join(menglanDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file in for-menglan/pending/");

    const content = await readFile(join(menglanDir, "pending", mdFiles[0]!), "utf8");
    assert.ok(content.startsWith("---"), "File should start with YAML frontmatter");
    assert.ok(content.includes("message_id:"), "Missing message_id field");
    assert.ok(content.includes("type: request"), "Missing type: request");
    assert.ok(content.includes("from: pandas"), "Missing from field");
    assert.ok(content.includes("to: menglan"), "Missing to field");
    assert.ok(content.includes("created_at:"), "Missing created_at field");
    assert.ok(content.includes("thread_id: thread_REQ033_1"), "Missing thread_id field");
    assert.ok(content.includes("correlation_id: corr_REQ033_1"), "Missing correlation_id field");
    assert.ok(content.includes("priority: P1"), "Missing priority field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-02 inbox_write_v2 type=request fields ────────────────────

test("TC-033-02: inbox_write_v2 type=request includes action and response_required", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-02-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_t1" "corr_t1" "" "P1" "true" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(join(menglanDir, "pending"));
    const content = await readFile(join(menglanDir, "pending", files.filter((f) => f.endsWith(".md"))[0]!), "utf8");
    assert.ok(content.includes("type: request"), "Missing type: request");
    assert.ok(content.includes("action: implement"), "Missing action field");
    assert.ok(content.includes("response_required: true"), "Missing response_required field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-03 inbox_write_v2 type=response fields ───────────────────

test("TC-033-03: inbox_write_v2 type=response includes in_reply_to, status, summary", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-03-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "pandas" "response" "" "thread_t1" "corr_t1" "msg_orig_001" "P2" "false" "" "completed" "" "TC approved"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandasDir = join(tmpDir, "inbox", "for-pandas");
    const files = await readdir(join(pandasDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await readFile(join(pandasDir, "pending", mdFiles[0]!), "utf8");
    assert.ok(content.includes("type: response"), "Missing type: response");
    assert.ok(content.includes("in_reply_to: msg_orig_001"), "Missing in_reply_to field");
    assert.ok(content.includes("status: completed"), "Missing status field in response envelope");
    assert.ok(content.includes("summary: TC approved"), "Missing summary field in response envelope");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-04 inbox_write_v2 type=notification fields ───────────────

test("TC-033-04: inbox_write_v2 type=notification includes event_type and severity", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-04-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "pandas" "notification" "deploy_complete" "thread_t1" "corr_t1" "" "P2" "false" "" "" "info"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandasDir = join(tmpDir, "inbox", "for-pandas");
    const files = await readdir(join(pandasDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await readFile(join(pandasDir, "pending", mdFiles[0]!), "utf8");
    assert.ok(content.includes("type: notification"), "Missing type: notification");
    assert.ok(content.includes("event_type: deploy_complete"), "Missing event_type field");
    assert.ok(content.includes("severity: info"), "Missing severity field in notification envelope");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-05 inbox_write() backward compat ─────────────────────────

test("TC-033-05: inbox_write() @deprecated wrapper calls inbox_write_v2 and produces ATM envelope", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-05-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write "menglan" "implement" "REQ-033" "test summary"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(join(menglanDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file from deprecated inbox_write() in for-menglan/pending/");

    const content = await readFile(join(menglanDir, "pending", mdFiles[0]!), "utf8");
    // New ATM envelope fields
    assert.ok(content.includes("message_id:"), "Missing message_id — inbox_write_v2 not called");
    assert.ok(content.includes("type: request"), "Missing type: request");
    assert.ok(content.includes("action: implement"), "Missing action: implement");
    // Legacy payload preserved
    assert.ok(content.includes("req_id: REQ-033"), "Missing legacy req_id field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-06 inbox_read_pandas ATM response (tc_complete) routing ───
// NOTE: ATM direction for "implement" is Pandas→Menglan ONLY.
// Menglan→Pandas completion signals must be type=response (not request).
// This test verifies the correct ATM pattern: type=response + legacy_type=tc_complete.

test("TC-033-06: inbox_read_pandas routes ATM response (legacy_type=tc_complete, status=completed) to _handle_tc_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-06-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-atm-tc-resp.md"),
    // type=response with legacy_type=tc_complete in payload — correct Menglan→Pandas direction
    "---\nmessage_id: msg_test_006\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: thread_test\ncorrelation_id: corr_test\npriority: P1\n---\nreq_id: REQ-033\nstatus: completed\nsummary: TC approved\nlegacy_type: tc_complete\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // tc_complete + status=completed → _handle_tc_complete → route implement to menglan
    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(join(menglanDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message routed to for-menglan/pending/ via _handle_tc_complete");
    // Verify direction: response stdout should mention tc_complete routing path
    assert.ok(
      result.stdout.includes("tc_complete") || result.stdout.includes("ATM response"),
      `Expected tc_complete routing path. stdout: ${result.stdout.slice(0, 300)}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-07 inbox_read_pandas ATM response routing ────────────────
// Verifies BLOCK-1 fix: status=completed (ATM canonical) is treated as success

test("TC-033-07: inbox_read_pandas routes ATM response (status=completed, legacy_type=dev_complete) to _handle_dev_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-07-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-atm-resp.md"),
    // status=completed (ATM canonical) with legacy_type=dev_complete — must trigger tg_pr_ready
    "---\nmessage_id: msg_resp_001\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: thread_test\ncorrelation_id: corr_test\npriority: P2\n---\nreq_id: REQ-033\npr_number: 42\nsummary: 实现完成\nstatus: completed\nlegacy_type: dev_complete\n",
    "utf8",
  );

  try {
    const tgMock = `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }`;
    const result = await runBash(
      `${tgMock}
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_pr_ready]"),
      `Expected tg_pr_ready to be called for dev_complete success. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-08 inbox_read_pandas ATM notification severity=action-required ─

test("TC-033-08: inbox_read_pandas notification severity=action-required triggers tg_notify", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-08-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-atm-notif.md"),
    "---\nmessage_id: msg_notif_001\ntype: notification\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: thread_test\ncorrelation_id: corr_test\npriority: P1\nevent_type: pipeline_failed\nseverity: action-required\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_notify_called=0
       tg_notify() { tg_notify_called=1; echo "[mock tg_notify] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_notify() { tg_notify_called=1; echo "[mock tg_notify] $*"; return 0; }
       inbox_init
       inbox_read_pandas
       echo "tg_notify_called=$tg_notify_called"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_notify]") || result.stdout.includes("tg_notify_called=1"),
      `Expected tg_notify for action-required notification. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-09 inbox_read_pandas legacy type=tc_complete ──────────────

test("TC-033-09: inbox_read_pandas routes legacy type=tc_complete via _inbox_read_legacy", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-09-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-legacy-tc.md"),
    "---\ntype: tc_complete\nreq_id: REQ-033\nstatus: success\nsummary: TC approved\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(join(menglanDir, "pending"));
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message routed to for-menglan/pending/ via legacy handler");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── merge-ready-queue fallback regression ─────────────────────────────────────
// Regression: _handle_review_complete must write merge-ready-queue.txt when
// Telegram fails, even when runtime/ does not yet exist (mkdir -p guard).

test("_handle_review_complete: Telegram failure writes merge-ready-queue.txt without aborting", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-mrq-fallback-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  // Intentionally do NOT create runtime/ — test that mkdir -p creates it
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-24-review-complete.md"),
    "---\nmessage_id: msg_rc_001\ntype: response\nfrom: huahua\nto: pandas\ncreated_at: 2026-03-24T00:00:00Z\nthread_id: thread_rc\ncorrelation_id: corr_rc\npriority: P1\n---\nreq_id: REQ-099\npr_number: 99\nstatus: completed\nsummary: LGTM\nlegacy_type: review_complete\n",
    "utf8",
  );

  try {
    const result = await runBash(
      // Override tg_pr_ready to always fail — simulates missing Telegram config
      `tg_pr_ready() { return 1; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { return 1; }
       inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    // Script must not abort — exit 0
    assert.equal(result.code, 0, `Expected exit 0 after Telegram failure. stdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // merge-ready-queue.txt must be created (even though runtime/ didn't exist before)
    const queuePath = join(tmpDir, "runtime", "merge-ready-queue.txt");
    let queueContent: string;
    try {
      const { readFile: rf } = await import("node:fs/promises");
      queueContent = await rf(queuePath, "utf8");
    } catch {
      assert.fail(`merge-ready-queue.txt was not created at ${queuePath}`);
    }

    assert.ok(queueContent!.includes("REQ-099"), `Expected REQ-099 in queue. Content: ${queueContent}`);
    assert.ok(queueContent!.includes("99"), `Expected PR #99 in queue. Content: ${queueContent}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-034: TC-034-* Claim 原子性 + 生命周期目录 ────────────────────────────

// TC-034-01: 正常 claim → done/
test("TC-034-01: inbox_read_pandas moves message from pending/ to done/ after successful dispatch", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-01-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const msgFile = join(pendingDir, "2026-03-20-test-034-01.md");
  await writeFile(
    msgFile,
    "---\ntype: review_blocked\nreq_id: REQ-034\nsummary: test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const doneDir = join(tmpDir, "inbox", "for-pandas", "done");
    const doneFiles = await readdir(doneDir);
    assert.ok(doneFiles.includes("2026-03-20-test-034-01.md"), "Message should be in done/");
    assert.ok(!existsSync(msgFile), "Message should no longer be in pending/");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-02: Claim 竞争 → skip（不报错）
test("TC-034-02: inbox_read_pandas skips silently when pending file is taken by a competing worker (ENOENT race)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-02-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const basename = "2026-03-20-test-034-02.md";
  await writeFile(
    join(pendingDir, basename),
    "---\ntype: review_blocked\nreq_id: REQ-034\nsummary: test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    // Simulate genuine race: override mv so that for pending->claimed moves it removes the
    // source (simulating another worker already took it) then returns 1 (ENOENT scenario).
    // The fixed code checks [[ ! -f source ]] after mv failure — this branch should be silent.
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       mv() {
         if [[ "$1" == */pending/* && "$2" == */claimed/* ]]; then
           /bin/rm -f "$1"
           return 1
         fi
         /bin/mv "$@"
       }
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, "Should exit 0 for genuine race (source file gone after mv failure)");
    // Genuine race must not emit ERROR to stderr
    assert.ok(!result.stderr.includes("ERROR:"), `No ERROR for genuine race. stderr: ${result.stderr}`);
    // Source consumed (removed by the competing-worker simulation)
    assert.ok(!existsSync(join(pendingDir, basename)), "File should be gone from pending/ after race");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-09: 非竞争 mv 错误（源文件仍在）→ 报错日志，file 留在 pending/
test("TC-034-09: non-race mv failure (source still present) emits error log and leaves file in pending/", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-09-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const basename = "2026-03-20-test-034-09.md";
  await writeFile(
    join(pendingDir, basename),
    "---\ntype: review_blocked\nreq_id: REQ-034\nsummary: test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    // Override mv to fail WITHOUT removing the source — simulates a real fs error
    // (e.g. disk full, permission on destination) where source is still intact.
    // The fixed code should emit an error log for this path (not silently skip).
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       mv() {
         if [[ "$1" == */pending/* && "$2" == */claimed/* ]]; then
           return 1  # fail but leave source untouched
         fi
         /bin/mv "$@"
       }
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, "Should exit 0 overall (other messages can still be processed)");
    // Non-race error must be surfaced — err() writes "[pandas] Claim mv 失败..." to stderr
    assert.ok(
      result.stderr.includes("pandas") && result.stderr.includes("Claim mv"),
      `Expected [pandas] prefix and "Claim mv" in stderr for non-race mv failure. stderr: ${result.stderr}`,
    );
    // Source must remain in pending/ (not consumed silently)
    assert.ok(
      existsSync(join(pendingDir, basename)),
      "File should remain in pending/ when mv fails with source still present",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-03: Handler 成功 → done/ 内容与原 pending/ 一致
test("TC-034-03: message in done/ after success retains original frontmatter content", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-03-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const originalContent =
    "---\nmessage_id: msg_test_034_03\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: t1\ncorrelation_id: c1\npriority: P2\n---\nreq_id: REQ-034\nstatus: completed\nlegacy_type: dev_complete\npr_number: 1\nsummary: done\n";
  const msgFile = join(pendingDir, "2026-03-20-test-034-03.md");
  await writeFile(msgFile, originalContent, "utf8");

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const doneFile = join(tmpDir, "inbox", "for-pandas", "done", "2026-03-20-test-034-03.md");
    assert.ok(existsSync(doneFile), "Message should be in done/");
    const doneContent = await readFile(doneFile, "utf8");
    assert.ok(doneContent.includes("message_id: msg_test_034_03"), "done/ file should retain original message_id");
    assert.ok(doneContent.startsWith("---"), "done/ file should retain frontmatter");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-04: Handler 失败 → failed/ + 错误摘要行
test("TC-034-04: handler failure moves message to failed/ with ERROR: line appended", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-04-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const msgFile = join(pendingDir, "2026-03-20-test-034-04.md");
  await writeFile(
    msgFile,
    // type=request with unknown action → dispatch returns 0 (warns), but we mock _dispatch_msg to fail
    "---\ntype: review_blocked\nreq_id: REQ-034\nsummary: test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    // Override _dispatch_msg to return 1 (simulate handler failure)
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       _dispatch_msg() { return 1; }
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    // May exit non-zero (err() call), but failed/ file should exist
    const failedDir = join(tmpDir, "inbox", "for-pandas", "failed");
    const failedFiles = await readdir(failedDir);
    assert.ok(failedFiles.includes("2026-03-20-test-034-04.md"), "Message should be in failed/");

    const failedContent = await readFile(join(failedDir, "2026-03-20-test-034-04.md"), "utf8");
    assert.ok(failedContent.includes("ERROR:"), "failed/ file should contain ERROR: summary line");
    assert.ok(!existsSync(msgFile), "Message should no longer be in pending/");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-05: inbox_init 幂等
test("TC-034-05: inbox_init is idempotent — repeated calls do not error and dirs exist", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-05-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_init; inbox_init; echo "exit_ok"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(result.stdout.includes("exit_ok"), "Should complete without error");
    for (const agent of ["pandas", "huahua", "menglan"]) {
      for (const sub of ["pending", "claimed", "done", "failed"]) {
        const subDir = join(tmpDir, "inbox", `for-${agent}`, sub);
        assert.ok(existsSync(subDir), `${agent}/${sub}/ should exist`);
      }
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-06: inbox_write_v2 落在 pending/
test("TC-034-06: inbox_write_v2 writes to for-target/pending/ not flat directory", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-06-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "huahua" "request" "tc_design" "thread_034_6" "corr_034_6" "" "P1" "false" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // pending/ should have the file
    const pendingDir = join(tmpDir, "inbox", "for-huahua", "pending");
    const pendingFiles = await readdir(pendingDir);
    assert.ok(pendingFiles.some((f) => f.endsWith(".md")), "Expected .md file in for-huahua/pending/");

    // flat for-huahua/ should have no .md files
    const flatDir = join(tmpDir, "inbox", "for-huahua");
    const flatFiles = await readdir(flatDir);
    assert.ok(!flatFiles.some((f) => f.endsWith(".md")), "No .md files should be in flat for-huahua/");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-07: 旧扁平格式仍可处理（向后兼容）
test("TC-034-07: inbox_read_pandas still processes legacy flat-directory messages", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-07-${Date.now()}`);
  const inboxDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // Write flat-format message (old style)
  const msgFile = join(inboxDir, "2026-03-20-flat-legacy-034-07.md");
  await writeFile(
    msgFile,
    "---\ntype: review_blocked\nreq_id: REQ-034\nsummary: legacy test\nstatus: blocked\nblocking_reason: test\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    // Flat file should be consumed (deleted) by the compat path
    assert.ok(!existsSync(msgFile), "Legacy flat message should be consumed");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-034-08: failed/ 文件格式 — 包含原 frontmatter + ERROR: 摘要行
test("TC-034-08: failed/ file contains original frontmatter and appended ERROR: line", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-034-08-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const originalFrontmatter =
    "---\nmessage_id: msg_034_08\ntype: notification\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T10:00:00Z\nthread_id: t034\ncorrelation_id: c034\npriority: P1\nevent_type: test_event\nseverity: info\n---\n";
  const msgFile = join(pendingDir, "2026-03-20-test-034-08.md");
  await writeFile(msgFile, originalFrontmatter, "utf8");

  try {
    // Override _dispatch_msg to return 1 (simulate handler failure)
    await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       _dispatch_msg() { return 1; }
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );

    const failedFile = join(tmpDir, "inbox", "for-pandas", "failed", "2026-03-20-test-034-08.md");
    assert.ok(existsSync(failedFile), "Message should be in failed/");
    const content = await readFile(failedFile, "utf8");

    // Original frontmatter must be preserved
    assert.ok(content.includes("message_id: msg_034_08"), "failed/ file must retain original message_id");
    assert.ok(content.includes("---"), "failed/ file must retain frontmatter delimiters");

    // ERROR: summary line must be appended
    assert.ok(content.includes("ERROR:"), "failed/ file must contain ERROR: summary line");
    // ERROR: line should be after the original content (appended, not prepended)
    const errorIndex = content.indexOf("ERROR:");
    const fmIndex = content.indexOf("message_id:");
    assert.ok(errorIndex > fmIndex, "ERROR: line should appear after original frontmatter");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-10 inbox_read_pandas legacy type=dev_complete ─────────────

test("TC-033-10: inbox_read_pandas routes legacy type=dev_complete via _inbox_read_legacy", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-10-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-legacy-dev.md"),
    "---\ntype: dev_complete\nreq_id: REQ-033\npr_number: 99\nsummary: 实现完成\nstatus: success\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("[mock tg_pr_ready]"),
      `Expected tg_pr_ready for legacy dev_complete success. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-035: TC-035-* Thread & Correlation Tracking ─────────────────────────

// TC-035-01: First inbox_write creates thread_id with correct prefix, does not modify REQ file
test("TC-035-01: first inbox_write creates thread_id with thread_REQ-035_ prefix in Envelope; REQ file unchanged", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const reqFile = join(PROJECT_ROOT, "tasks", "archive", "done", "REQ-035.md");
  const reqContentBefore = await readFile(reqFile, "utf8");

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_write "menglan" "implement" "REQ-035" "first request"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const menglanPendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(menglanPendingDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file in for-menglan/pending/");

    const content = await readFile(join(menglanPendingDir, mdFiles[0]!), "utf8");
    assert.ok(
      content.includes("thread_id: thread_REQ-035_"),
      `thread_id must start with thread_REQ-035_. Got:\n${content}`,
    );
    assert.ok(
      content.includes("correlation_id: corr_REQ-035_"),
      `correlation_id must start with corr_REQ-035_. Got:\n${content}`,
    );

    // REQ file must not be modified (thread_id never written back to REQ files)
    const reqContentAfter = await readFile(reqFile, "utf8");
    assert.equal(reqContentAfter, reqContentBefore, "REQ file must not be modified by inbox_write");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-02: Second inbox_write after first moves to done/ reuses same thread_id, different correlation_id
test("TC-035-02: second inbox_write for same REQ reuses thread_id and generates new correlation_id", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-02-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    // Both requests happen inside one bash script so INBOX_ROOT is consistent.
    // The first message is moved to done/ before the second write.
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       inbox_write "menglan" "implement" "REQ-035" "first request"
       pending_file=\$(ls "${tmpDir}/inbox/for-menglan/pending/"*.md 2>/dev/null | head -1)
       [[ -n "\$pending_file" ]] && /bin/mv "\$pending_file" "${tmpDir}/inbox/for-menglan/done/"
       inbox_write "menglan" "implement" "REQ-035" "second request"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const doneDir = join(tmpDir, "inbox", "for-menglan", "done");
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const doneMd = (await readdir(doneDir)).filter((f) => f.endsWith(".md"));
    const pendingMd = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));

    assert.equal(doneMd.length, 1, "Expected exactly one message in done/");
    assert.equal(pendingMd.length, 1, "Expected exactly one message in pending/");

    const doneContent = await readFile(join(doneDir, doneMd[0]!), "utf8");
    const pendingContent = await readFile(join(pendingDir, pendingMd[0]!), "utf8");

    const threadMatch1 = doneContent.match(/^thread_id:\s*(.+)$/m);
    const threadMatch2 = pendingContent.match(/^thread_id:\s*(.+)$/m);
    assert.ok(threadMatch1 && threadMatch2, "Both messages must have thread_id");
    assert.equal(
      threadMatch1![1]!.trim(),
      threadMatch2![1]!.trim(),
      "thread_id must be reused across both messages for the same REQ",
    );

    const corrMatch1 = doneContent.match(/^correlation_id:\s*(.+)$/m);
    const corrMatch2 = pendingContent.match(/^correlation_id:\s*(.+)$/m);
    assert.ok(corrMatch1 && corrMatch2, "Both messages must have correlation_id");
    assert.notEqual(
      corrMatch1![1]!.trim(),
      corrMatch2![1]!.trim(),
      "correlation_id must differ between the two requests",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-03: Response with matching correlation_id → routes to for-pandas/done/
test("TC-035-03: response with correlation_id matching request in for-menglan/done/ routes to for-pandas/done/", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-03-${Date.now()}`);
  const pandasPending = join(tmpDir, "inbox", "for-pandas", "pending");
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  await mkdir(pandasPending, { recursive: true });
  await mkdir(menglanDone, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const corrId = "corr_REQ-035_matching_test";
  const threadId = "thread_REQ-035_1000000";

  // Pre-populate the outbox (original request already processed by menglan)
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-03-request.md"),
    `---\nmessage_id: msg_tc035_03_req\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrId}\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: first request\nlegacy_type: implement\n`,
    "utf8",
  );

  // Place the matching response in pandas' inbox
  await writeFile(
    join(pandasPending, "2026-03-21-req-035-03-response.md"),
    `---\nmessage_id: msg_tc035_03_resp\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T01:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrId}\npriority: P1\nstatus: completed\n---\nreq_id: REQ-035\npr_number: 99\nsummary: implemented\nlegacy_type: dev_complete\nstatus: completed\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandaDone = join(tmpDir, "inbox", "for-pandas", "done");
    const doneFiles = await readdir(pandaDone);
    assert.ok(
      doneFiles.includes("2026-03-21-req-035-03-response.md"),
      `Message with matching corr should be in done/. done/ contains: ${doneFiles.join(", ")}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-04: Response with mismatched correlation_id → warn + moves to for-pandas/failed/
test("TC-035-04: response with mismatched correlation_id emits warn and moves to for-pandas/failed/", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-04-${Date.now()}`);
  const pandasPending = join(tmpDir, "inbox", "for-pandas", "pending");
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  await mkdir(pandasPending, { recursive: true });
  await mkdir(menglanDone, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const originalCorr = "corr_REQ-035_original";
  const mismatchedCorr = "corr_REQ-035_wrong";
  const threadId = "thread_REQ-035_2000000";

  // Original request in outbox with originalCorr
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-04-request.md"),
    `---\nmessage_id: msg_tc035_04_req\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${originalCorr}\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: first request\nlegacy_type: implement\n`,
    "utf8",
  );

  // Response with WRONG correlation_id
  await writeFile(
    join(pandasPending, "2026-03-21-req-035-04-response.md"),
    `---\nmessage_id: msg_tc035_04_resp\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T01:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${mismatchedCorr}\npriority: P1\nstatus: completed\n---\nreq_id: REQ-035\npr_number: 99\nsummary: implemented\nlegacy_type: dev_complete\nstatus: completed\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(
      result.code,
      0,
      `Should exit 0 overall even when a single message fails\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );

    // Message must be in failed/
    const pandasFailed = join(tmpDir, "inbox", "for-pandas", "failed");
    const failedFiles = await readdir(pandasFailed);
    assert.ok(
      failedFiles.includes("2026-03-21-req-035-04-response.md"),
      `Mismatched-corr response should be in failed/. failed/ contains: ${failedFiles.join(", ")}`,
    );

    // warn() writes to stdout; must mention correlation_id
    assert.ok(
      result.stdout.includes("correlation_id") || result.stderr.includes("correlation_id"),
      `Expected correlation_id warn log. stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-05: thread_get_or_create is idempotent — two calls return same thread_id
test("TC-035-05: thread_get_or_create REQ-035 is idempotent when a message trail exists in done/", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-05-${Date.now()}`);
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  await mkdir(menglanDone, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const knownThread = "thread_REQ-035_9999999";

  // Pre-populate done/ with a message carrying the known thread_id
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-05-seed.md"),
    `---\nmessage_id: msg_tc035_05_seed\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${knownThread}\ncorrelation_id: corr_REQ-035_idem\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: idempotency seed\nlegacy_type: implement\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null
       inbox_init
       t1=\$(thread_get_or_create "REQ-035")
       t2=\$(thread_get_or_create "REQ-035")
       echo "t1=\$t1"
       echo "t2=\$t2"
       [[ "\$t1" == "\$t2" ]] && echo "idempotent=yes" || echo "idempotent=no"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      result.stdout.includes("idempotent=yes"),
      `thread_get_or_create must be idempotent. stdout: ${result.stdout}`,
    );
    assert.ok(
      result.stdout.includes(knownThread),
      `Both calls must return the known thread_id ${knownThread}. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-06: Full chain — thread_id links all related messages via done/ trails
test("TC-035-06: after processing, thread_id in done/ dirs links request and response (full chain reconstructible)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-06-${Date.now()}`);
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  const pandasPending = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(menglanDone, { recursive: true });
  await mkdir(pandasPending, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const sharedThread = "thread_REQ-035_chain_test";
  const corrA = "corr_REQ-035_chain_a";

  // Outgoing request already in menglan/done (processed by menglan)
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-06-request.md"),
    `---\nmessage_id: msg_tc035_06_req\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${sharedThread}\ncorrelation_id: ${corrA}\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: chain request\nlegacy_type: implement\n`,
    "utf8",
  );

  // Matching response arrives in pandas' inbox
  await writeFile(
    join(pandasPending, "2026-03-21-req-035-06-response.md"),
    `---\nmessage_id: msg_tc035_06_resp\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T01:00:00Z\nthread_id: ${sharedThread}\ncorrelation_id: ${corrA}\npriority: P1\nstatus: completed\n---\nreq_id: REQ-035\npr_number: 35\nsummary: chain done\nlegacy_type: dev_complete\nstatus: completed\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandaDone = join(tmpDir, "inbox", "for-pandas", "done");
    const pandaDoneFiles = await readdir(pandaDone);
    assert.ok(
      pandaDoneFiles.includes("2026-03-21-req-035-06-response.md"),
      "Response should be in for-pandas/done/",
    );

    // Request must still be in menglan/done (never touched by pandas reader)
    const menglanDoneFiles = await readdir(menglanDone);
    assert.ok(
      menglanDoneFiles.includes("2026-03-21-req-035-06-request.md"),
      "Request must remain in for-menglan/done/ for chain reconstruction",
    );

    // Both files must carry the same thread_id — grep-for-traceability requirement
    const requestContent = await readFile(join(menglanDone, "2026-03-21-req-035-06-request.md"), "utf8");
    const responseContent = await readFile(join(pandaDone, "2026-03-21-req-035-06-response.md"), "utf8");
    assert.ok(
      requestContent.includes(`thread_id: ${sharedThread}`),
      "Request in done/ must carry the shared thread_id",
    );
    assert.ok(
      responseContent.includes(`thread_id: ${sharedThread}`),
      "Response in done/ must carry the shared thread_id",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-07: Second round-trip response (newer corr) passes validation
test("TC-035-07: response with second request's correlation_id passes validation when two requests exist in outbox", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-07-${Date.now()}`);
  const pandasPending = join(tmpDir, "inbox", "for-pandas", "pending");
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  await mkdir(pandasPending, { recursive: true });
  await mkdir(menglanDone, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const threadId = "thread_REQ-035_multi";
  const corrOld = "corr_REQ-035_round1";
  const corrNew = "corr_REQ-035_round2";

  // First (older) request already in done/ with corrOld
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-07-request-1.md"),
    `---\nmessage_id: msg_tc035_07_req1\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrOld}\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: first round\nlegacy_type: implement\n`,
    "utf8",
  );

  // Second (newer) request in done/ with corrNew
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-07-request-2.md"),
    `---\nmessage_id: msg_tc035_07_req2\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T01:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrNew}\npriority: P1\naction: implement\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: second round\nlegacy_type: implement\n`,
    "utf8",
  );

  // Response to second request carries corrNew
  await writeFile(
    join(pandasPending, "2026-03-21-req-035-07-response.md"),
    `---\nmessage_id: msg_tc035_07_resp\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T02:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrNew}\npriority: P1\nstatus: completed\n---\nreq_id: REQ-035\npr_number: 42\nsummary: second round done\nlegacy_type: dev_complete\nstatus: completed\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Response must be in done/ — corrNew matches the second request (valid)
    const pandaDone = join(tmpDir, "inbox", "for-pandas", "done");
    const doneFiles = await readdir(pandaDone);
    assert.ok(
      doneFiles.includes("2026-03-21-req-035-07-response.md"),
      `Second-round response (corrNew) should pass and be in done/. done/: ${doneFiles.join(", ")}`,
    );

    // No false correlation_id error
    assert.ok(
      !result.stdout.includes("correlation_id 不匹配") && !result.stderr.includes("correlation_id 不匹配"),
      `Should not emit correlation mismatch warn. stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-035-08: Response without correlation_id (Huahua compat) skips validation and routes to done/
test("TC-035-08: response without correlation_id field skips validation and routes to for-pandas/done/ (Huahua compat)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-035-08-${Date.now()}`);
  const pandasPending = join(tmpDir, "inbox", "for-pandas", "pending");
  const menglanDone = join(tmpDir, "inbox", "for-menglan", "done");
  await mkdir(pandasPending, { recursive: true });
  await mkdir(menglanDone, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  const threadId = "thread_REQ-035_compat";
  const corrKnown = "corr_REQ-035_known";

  // Known request exists in outbox with corrKnown
  await writeFile(
    join(menglanDone, "2026-03-21-req-035-08-request.md"),
    `---\nmessage_id: msg_tc035_08_req\ntype: request\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: ${threadId}\ncorrelation_id: ${corrKnown}\npriority: P1\naction: review\nresponse_required: true\n---\nreq_id: REQ-035\nsummary: review request\nlegacy_type: review\n`,
    "utf8",
  );

  // Huahua-style response: no correlation_id field in frontmatter
  await writeFile(
    join(pandasPending, "2026-03-21-req-035-08-response.md"),
    `---\nmessage_id: msg_tc035_08_resp\ntype: response\nfrom: huahua\nto: pandas\ncreated_at: 2026-03-21T01:00:00Z\nthread_id: ${threadId}\npriority: P1\nstatus: completed\n---\nreq_id: REQ-035\npr_number: 35\nsummary: review approved\nlegacy_type: review_complete\nstatus: success\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Response with no corr field must still reach done/ (validation skipped)
    const pandaDone = join(tmpDir, "inbox", "for-pandas", "done");
    const doneFiles = await readdir(pandaDone);
    assert.ok(
      doneFiles.includes("2026-03-21-req-035-08-response.md"),
      `Huahua-compat response (no corr field) should be in done/. done/: ${doneFiles.join(", ")}`,
    );

    // No false correlation_id error
    assert.ok(
      !result.stdout.includes("correlation_id 不匹配") && !result.stderr.includes("correlation_id 不匹配"),
      `Should not emit correlation mismatch for missing corr field. stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-036: TC-036-* Delegation 结构化 + 文件命名规范 ────────────────────────

// TC-036-01: delegation 完整 — 无 warn，无 delegation_incomplete，文件名为新格式
test("TC-036-01: inbox_write_v2 type=request with all delegation fields: no warn, no delegation_incomplete, new filename format", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const payloadFile = join(tmpDir, "payload.md");
  await writeFile(
    payloadFile,
    "objective: implement feature X\nscope: scripts only\nexpected_output: working function\ndone_criteria: all tests pass\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_1" "corr_036_1" "" "P1" "true" "${payloadFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // No delegation warn
    assert.ok(
      !result.stderr.includes("delegation incomplete"),
      `Should not warn about delegation. stderr: ${result.stderr}`,
    );

    // File exists in pending/
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(pendingDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file in for-menglan/pending/");

    // New filename format: YYYYMMDDHHMMSS_request_pandas_to_menglan_corr_036_1.md
    // No double underscores, no ISO date prefix, no colons
    const filename = mdFiles[0];
    assert.ok(
      /^\d{14}_request_pandas_to_menglan_corr_036_1\.md$/.test(filename),
      `Filename should match new canonical format YYYYMMDDHHMMSS_request_pandas_to_menglan_corr_036_1.md, got: ${filename}`,
    );

    // Content should not contain delegation_incomplete
    const content = await readFile(join(pendingDir, filename), "utf8");
    assert.ok(
      !content.includes("delegation_incomplete:"),
      `File should not contain delegation_incomplete. content: ${content}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-02: delegation 不完整 — warn + delegation_incomplete: true 写入 envelope
test("TC-036-02: inbox_write_v2 type=request missing done_criteria: emits warn and writes delegation_incomplete: true", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-02-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const payloadFile = join(tmpDir, "payload.md");
  await writeFile(
    payloadFile,
    "objective: implement feature Y\nscope: scripts only\nexpected_output: working function\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_2" "corr_036_2" "" "P1" "true" "${payloadFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed (should still succeed)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Warn emitted
    assert.ok(
      result.stderr.includes("delegation incomplete"),
      `Expected delegation incomplete warn. stderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("done_criteria"),
      `Warn should mention missing field done_criteria. stderr: ${result.stderr}`,
    );

    // File written with delegation_incomplete: true
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(pendingDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "File should still be written despite incomplete delegation");
    const content = await readFile(join(pendingDir, mdFiles[0]), "utf8");
    assert.ok(
      content.includes("delegation_incomplete: true"),
      `File must contain delegation_incomplete: true. content: ${content}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-03: 新命名格式文件 — inbox_read_pandas 正常解析并路由到 done/
test("TC-036-03: inbox_read_pandas processes message with new canonical filename format", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-03-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // New canonical format filename
  const newFmtFile = join(pendingDir, "20260321000000_response_menglan_to_pandas_corr_REQ036_new.md");
  await writeFile(
    newFmtFile,
    "---\nmessage_id: msg_tc036_03\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: thread_036_3\ncorrelation_id: corr_036_3\npriority: P2\nstatus: completed\n---\nreq_id: REQ-036\npr_number: 100\nsummary: done\nlegacy_type: dev_complete\nstatus: completed\n",
    "utf8",
  );

  try {
    const tgMock = `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }`;
    const result = await runBash(
      `${tgMock}
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Message should be moved to done/ (new-format filename works)
    const doneDir = join(tmpDir, "inbox", "for-pandas", "done");
    assert.ok(existsSync(doneDir), "done/ dir should exist");
    const doneFiles = await readdir(doneDir);
    assert.ok(
      doneFiles.some((f) => f.endsWith(".md")),
      `Message should be in done/ after processing new-format filename. done/: ${doneFiles.join(", ")}`,
    );
    // Original pending file should be gone
    assert.ok(!existsSync(newFmtFile), "Pending file should be consumed");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-04: 旧命名格式文件 — inbox_read_pandas 仍可正常解析（向后兼容）
test("TC-036-04: inbox_read_pandas processes message with old REQ-033 filename format (backward compat)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-04-${Date.now()}`);
  const pendingDir = join(tmpDir, "inbox", "for-pandas", "pending");
  await mkdir(pendingDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  // Old REQ-033 transitional format filename
  const oldFmtFile = join(pendingDir, "2026-03-21T00-00-00Z__response__menglan_to_pandas__corr_REQ036_old.md");
  await writeFile(
    oldFmtFile,
    "---\nmessage_id: msg_tc036_04\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-21T00:00:00Z\nthread_id: thread_036_4\ncorrelation_id: corr_036_4\npriority: P2\nstatus: completed\n---\nreq_id: REQ-036\npr_number: 101\nsummary: done\nlegacy_type: dev_complete\nstatus: completed\n",
    "utf8",
  );

  try {
    const tgMock = `tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }`;
    const result = await runBash(
      `${tgMock}
       source "${SCRIPT}" 2>/dev/null
       tg_pr_ready() { echo "[mock tg_pr_ready] $*"; return 0; }
       inbox_init
       inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Message should be moved to done/ (old-format filename still works)
    const doneDir = join(tmpDir, "inbox", "for-pandas", "done");
    assert.ok(existsSync(doneDir), "done/ dir should exist");
    const doneFiles = await readdir(doneDir);
    assert.ok(
      doneFiles.some((f) => f.endsWith(".md")),
      `Old-format message should be in done/ after processing. done/: ${doneFiles.join(", ")}`,
    );
    assert.ok(!existsSync(oldFmtFile), "Pending file should be consumed");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-05: context_summary 超 500 字 — 自动截断至 500 字 + warn
test("TC-036-05: inbox_write_v2 truncates context_summary >500 chars to 500 and emits warn", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-05-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const payloadFile = join(tmpDir, "payload.md");
  const longSummary = "x".repeat(600);
  await writeFile(
    payloadFile,
    `context_summary: ${longSummary}\nobjective: test\nscope: test\nexpected_output: test\ndone_criteria: test\n`,
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_5" "corr_036_5" "" "P2" "false" "${payloadFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Warn emitted
    assert.ok(
      result.stderr.includes("context_summary truncated"),
      `Expected truncation warn. stderr: ${result.stderr}`,
    );

    // Written file has context_summary ≤ 500 chars
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(pendingDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "File should be written");
    const content = await readFile(join(pendingDir, mdFiles[0]), "utf8");
    const csMatch = content.match(/^context_summary: (.*)$/m);
    assert.ok(csMatch, `File should contain context_summary field. content: ${content}`);
    assert.ok(
      csMatch![1].length <= 500,
      `context_summary value should be ≤500 chars, got ${csMatch![1].length}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-06: references type 不在枚举内 — warn
test("TC-036-06: inbox_write_v2 emits warn when references block contains type not in enum", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-06-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const payloadFile = join(tmpDir, "payload.md");
  await writeFile(
    payloadFile,
    "objective: test\nscope: test\nexpected_output: test\ndone_criteria: test\nreferences:\n  - type: invalid_type\n    id: REQ-999\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_6" "corr_036_6" "" "P2" "false" "${payloadFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed (should still succeed)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Warn about invalid references type
    assert.ok(
      result.stderr.includes("references type"),
      `Expected references type warn. stderr: ${result.stderr}`,
    );
    assert.ok(
      result.stderr.includes("not in enum"),
      `Warn should say 'not in enum'. stderr: ${result.stderr}`,
    );

    // File still written (non-blocking)
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(pendingDir);
    assert.ok(
      files.some((f) => f.endsWith(".md")),
      "File should still be written despite invalid references type",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-07: type=request without payload_file — warn + delegation_incomplete: true
test("TC-036-07: inbox_write_v2 type=request with no payload_file: emits warn and writes delegation_incomplete: true", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-07-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_7" "corr_036_7" "" "P1" "true" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed (should still succeed)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Warn emitted about missing payload_file
    assert.ok(
      result.stderr.includes("delegation incomplete"),
      `Expected delegation incomplete warn. stderr: ${result.stderr}`,
    );

    // File written with delegation_incomplete: true
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = await readdir(pendingDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "File should still be written despite missing payload_file");
    const content = await readFile(join(pendingDir, mdFiles[0]), "utf8");
    assert.ok(
      content.includes("delegation_incomplete: true"),
      `File must contain delegation_incomplete: true. content: ${content}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-037: _auto_worktree_clean ───────────────────────────────────────────

/**
 * Build a mock git binary in tmpDir/bin/ whose behaviour is controlled by
 * simple env vars, and return the mock bin path.
 *
 * MOCK_WORKTREE_PATH — if set, `git worktree list` includes this path
 * MOCK_BRANCH        — value returned by `git -C <path> branch --show-current`
 * MOCK_REMOVE_FILE   — if set, `git worktree remove --force <path>` writes "removed" to this file
 */
async function makeMockGit(binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const mockGit = join(binDir, "git");
  await writeFile(
    mockGit,
    `#!/usr/bin/env bash
# minimal git mock for _auto_worktree_clean tests
case "$*" in
  "worktree list")
    if [[ -n "\${MOCK_WORKTREE_PATH:-}" ]]; then
      echo "\${MOCK_WORKTREE_PATH}  abc1234 [feat/REQ-037]"
    fi
    ;;
  "-C "*" branch --show-current")
    echo "\${MOCK_BRANCH:-}"
    ;;
  "worktree remove --force "*)
    if [[ -n "\${MOCK_REMOVE_FILE:-}" ]]; then
      echo "removed" > "\${MOCK_REMOVE_FILE}"
    fi
    ;;
esac
exit 0
`,
    "utf8",
  );
  await chmod(mockGit, 0o755);
}

test("TC-037: _auto_worktree_clean skips when no worktree is mounted", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-037-clean-skip-${Date.now()}`);
  const binDir = join(tmpDir, "bin");
  await makeMockGit(binDir);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; REPO_ROOT="${tmpDir}" _auto_worktree_clean`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        MENGLAN_WORKTREE_ROOT: join(tmpDir, "worktree"),
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        // no MOCK_WORKTREE_PATH → git worktree list returns nothing
      },
    );
    assert.equal(result.code, 0, `should exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    // No "auto_worktree_clean" action log
    assert.ok(
      !result.stdout.includes("自动移除"),
      `Should not attempt removal when no worktree is mounted. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("TC-037: _auto_worktree_clean removes worktree when REQ status is done", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-037-clean-done-${Date.now()}`);
  const binDir = join(tmpDir, "bin");
  const worktreePath = join(tmpDir, "worktree");
  const removeMarker = join(tmpDir, "removed.flag");
  await makeMockGit(binDir);

  // Write a done REQ file in the tmp REPO_ROOT
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await writeFile(
    join(featuresDir, "REQ-037.md"),
    "---\nreq_id: REQ-037\nstatus: done\nowner: claude_code\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; REPO_ROOT="${tmpDir}" _auto_worktree_clean`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        MENGLAN_WORKTREE_ROOT: worktreePath,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        MOCK_WORKTREE_PATH: worktreePath,
        MOCK_BRANCH: "feat/REQ-037",
        MOCK_REMOVE_FILE: removeMarker,
      },
    );
    assert.equal(result.code, 0, `should exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      existsSync(removeMarker),
      `git worktree remove should have been called (marker file missing). stdout: ${result.stdout}`,
    );
    assert.ok(
      result.stdout.includes("自动移除") || result.stdout.includes("auto_worktree_clean"),
      `Expected removal log. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test("TC-037: _auto_worktree_clean leaves worktree when REQ is still in_progress", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-037-clean-live-${Date.now()}`);
  const binDir = join(tmpDir, "bin");
  const worktreePath = join(tmpDir, "worktree");
  const removeMarker = join(tmpDir, "removed.flag");
  await makeMockGit(binDir);

  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await writeFile(
    join(featuresDir, "REQ-037.md"),
    "---\nreq_id: REQ-037\nstatus: in_progress\nowner: claude_code\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; REPO_ROOT="${tmpDir}" _auto_worktree_clean`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        MENGLAN_WORKTREE_ROOT: worktreePath,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        MOCK_WORKTREE_PATH: worktreePath,
        MOCK_BRANCH: "feat/REQ-037",
        MOCK_REMOVE_FILE: removeMarker,
      },
    );
    assert.equal(result.code, 0, `should exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(
      !existsSync(removeMarker),
      `git worktree remove must NOT be called for an in_progress REQ. stdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-036-08: non-references type: field should NOT trigger references warn (false-positive regression)
test("TC-036-08: inbox_write_v2 does not emit references warn for type: field outside references block", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-036-08-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const payloadFile = join(tmpDir, "payload.md");
  // payload has a non-references top-level block with an indented type: field
  await writeFile(
    payloadFile,
    "objective: test\nscope: test\nexpected_output: test\ndone_criteria: test\nmetadata:\n  type: internal\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "menglan" "request" "implement" "thread_036_8" "corr_036_8" "" "P2" "false" "${payloadFile}"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // No references warn should be emitted
    assert.ok(
      !result.stderr.includes("references type"),
      `Should not emit references type warn for non-references block. stderr: ${result.stderr}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004: TC-022-05 claim_review_ready transitions review_ready → req_review ──

test("TC-022-05: claim_review_ready transitions review_ready REQ to req_review and writes huahua inbox", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-05-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  // review_ready REQ — should be claimed
  await writeFile(
    join(featuresDir, "REQ-903.md"),
    "---\nreq_id: REQ-903\ntitle: Review Ready Task\nstatus: review_ready\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  // already req_review REQ — should NOT be touched
  await writeFile(
    join(featuresDir, "REQ-904.md"),
    "---\nreq_id: REQ-904\ntitle: Already Claimed\nstatus: req_review\npriority: P1\nphase: phase-2\nowner: huahua\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; claim_review_ready`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ-903 must be transitioned
    const req903 = await readFile(join(featuresDir, "REQ-903.md"), "utf8");
    assert.ok(req903.includes("status: req_review"), `REQ-903 status should be req_review. Got:\n${req903}`);
    assert.ok(req903.includes("owner: huahua"), `REQ-903 owner should be huahua. Got:\n${req903}`);

    // REQ-904 must be untouched
    const req904 = await readFile(join(featuresDir, "REQ-904.md"), "utf8");
    assert.ok(req904.includes("status: req_review"), "REQ-904 status should remain req_review");
    assert.ok(req904.includes("owner: huahua"), "REQ-904 owner should remain huahua");

    // Huahua inbox must have a message for REQ-903
    const huahuaDir = join(tmpDir, "inbox", "for-huahua", "pending");
    const files = await readdir(huahuaDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected at least one message in for-huahua/pending/");

    const msgContent = await readFile(join(huahuaDir, mdFiles[0]!), "utf8");
    assert.ok(msgContent.includes("req_id: REQ-903"), `Huahua inbox message should reference REQ-903. Got:\n${msgContent}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004: TC-022-06 stale lock recovery ───────────────────────────────────

test("TC-022-06: claim_review_ready recovers stale lock and claims REQ", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-06-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  const reqFile = join(featuresDir, "REQ-905.md");
  await writeFile(
    reqFile,
    "---\nreq_id: REQ-905\ntitle: Stale Lock Test\nstatus: review_ready\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  // Simulate a crashed prior heartbeat: create a stale lock dir
  const lockDir = `${reqFile}.lock`;
  await mkdir(lockDir, { recursive: true });

  try {
    // _CLAIM_LOCK_STALE_S=0 forces any existing lock to be treated as stale
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; _CLAIM_LOCK_STALE_S=0 claim_review_ready`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Stale lock must have been cleaned by the script (rmdir'd after sed)
    assert.equal(existsSync(lockDir), false, `Stale lock dir should have been removed: ${lockDir}`);

    // REQ-905 must be transitioned
    const req905 = await readFile(reqFile, "utf8");
    assert.ok(req905.includes("status: req_review"), `REQ-905 should be req_review after stale lock recovery. Got:\n${req905}`);

    // Huahua inbox must have a message
    const huahuaFiles = (await readdir(join(tmpDir, "inbox", "for-huahua", "pending"))).filter((f) => f.endsWith(".md"));
    assert.ok(huahuaFiles.length > 0, "Huahua inbox should have a req_review message after stale lock recovery");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── BUG-004: TC-022-07 live lock skips REQ ───────────────────────────────────

test("TC-022-07: claim_review_ready skips REQ when live lock dir exists", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-022-07-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  const reqFile = join(featuresDir, "REQ-906.md");
  await writeFile(
    reqFile,
    "---\nreq_id: REQ-906\ntitle: Live Lock Test\nstatus: review_ready\npriority: P1\nphase: phase-2\nowner: unassigned\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  // Simulate a live competing heartbeat: create a fresh lock dir
  const lockDir = `${reqFile}.lock`;
  await mkdir(lockDir, { recursive: true });

  try {
    // High threshold (9999s) so the fresh lock is NOT treated as stale
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; _CLAIM_LOCK_STALE_S=9999 claim_review_ready`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ-906 must remain at review_ready (not claimed)
    const req906 = await readFile(reqFile, "utf8");
    assert.ok(req906.includes("status: review_ready"), `REQ-906 should remain review_ready when live lock exists. Got:\n${req906}`);

    // Huahua inbox must be empty
    const huahuaFiles = (await readdir(join(tmpDir, "inbox", "for-huahua", "pending"))).filter((f) => f.endsWith(".md"));
    assert.equal(huahuaFiles.length, 0, `Huahua inbox should be empty when live lock blocked claim. files: ${huahuaFiles.join(", ")}`);

    // Warn must appear in stderr (warn() writes to fd 2)
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes("竞争失败"), `Expected 竞争失败 warning. stdout: ${result.stdout}\nstderr: ${result.stderr}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: archive_merged_reqs ─────────────────────────────────────────────

/** Build a minimal REQ frontmatter string. */
function makeReqFrontmatter(opts: {
  reqId: string;
  status: string;
  prNumber?: string;
  tcRefs?: string[];
}): string {
  const tcRef = opts.tcRefs ? `[${opts.tcRefs.join(", ")}]` : "[]";
  const prLine = opts.prNumber ? `\npr_number: ${opts.prNumber}` : "";
  return (
    `---\nreq_id: ${opts.reqId}\ntitle: Test REQ\nstatus: ${opts.status}\n` +
    `priority: P2\nphase: phase-2\nowner: menglan\ndepends_on: []\n` +
    `test_case_ref: ${tcRef}\ntc_policy: required\ntc_exempt_reason: ""\n` +
    `scope: scripts\nacceptance: test${prLine}\npending_bugs: []\n---\n`
  );
}

/** Build a minimal TC frontmatter string. */
function makeTcFrontmatter(tcId: string, status = "ready"): string {
  return `---\ntc_id: ${tcId}\ntitle: Test TC\nreq_ref: REQ-099\nlayer: L1\ntype: functional\nstatus: ${status}\n---\n`;
}

/** Create a mock gh binary that returns a JSON state for given PR numbers. */
async function createMockGh(
  mockBin: string,
  prResponses: Record<string, { state?: string; exitCode?: number }>,
  callLog?: string,
): Promise<void> {
  const cases = Object.entries(prResponses)
    .map(([num, resp]) => {
      if (resp.exitCode && resp.exitCode !== 0) {
        return `    "${num}") echo "GraphQL: Not Found" >&2; exit ${resp.exitCode} ;;`;
      }
      return `    "${num}") echo '{"state":"${resp.state ?? "OPEN"}"}' ;;`;
    })
    .join("\n");
  const logLine = callLog ? `echo "$*" >> "${callLog}"\n` : "";
  const script = `#!/usr/bin/env bash
${logLine}# Extract PR number from args: gh pr view <number> --json state
pr_num=""
for arg in "$@"; do
  case "$arg" in
    [0-9]*) pr_num="$arg" ;;
  esac
done
case "$pr_num" in
${cases}
    *) echo '{"state":"OPEN"}' ;;
esac
exit 0
`;
  await writeFile(join(mockBin, "gh"), script, "utf8");
  await makeExecutable(join(mockBin, "gh"));
}

/** Create a mock git binary that records commit -m messages. */
async function createMockGit(mockBin: string, callLog: string): Promise<void> {
  const script = `#!/usr/bin/env bash
echo "GIT_CALLED $*" >> "${callLog}"
exit 0
`;
  await writeFile(join(mockBin, "git"), script, "utf8");
  await makeExecutable(join(mockBin, "git"));
}

// TC-031-01: PR merged → REQ + TC archived, status done, git commit called
test("TC-031-01: archive_merged_reqs archives REQ and TC when PR is MERGED", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-01-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const tcDir = join(tmpDir, "tasks", "test-cases");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(tcDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    makeReqFrontmatter({ reqId: "REQ-099", status: "review", prNumber: "42", tcRefs: ["TC-099-01"] }),
    "utf8",
  );
  await writeFile(join(tcDir, "TC-099-01.md"), makeTcFrontmatter("TC-099-01"), "utf8");

  const callLog = join(tmpDir, "calls.log");
  await createMockGh(mockBin, { "42": { state: "MERGED" } }, callLog);
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ moved and status updated to done
    assert.ok(existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should be in archive/done/");
    assert.ok(!existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should be removed from features/");
    const reqContent = await readFile(join(archiveDir, "REQ-099.md"), "utf8");
    assert.ok(reqContent.includes("status: done"), `REQ status should be done. Got:\n${reqContent}`);

    // TC moved and status updated to done
    assert.ok(existsSync(join(archiveDir, "TC-099-01.md")), "TC-099-01.md should be in archive/done/");
    assert.ok(!existsSync(join(tcDir, "TC-099-01.md")), "TC-099-01.md should be removed from test-cases/");
    const tcContent = await readFile(join(archiveDir, "TC-099-01.md"), "utf8");
    assert.ok(tcContent.includes("status: done"), `TC status should be done. Got:\n${tcContent}`);

    // git commit called with correct message
    const log = await readFile(callLog, "utf8");
    assert.ok(log.includes("archive(REQ-099): move to tasks/archive/done/"),
      `Expected archive commit message. calls.log:\n${log}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-031-02: PR is OPEN → no archiving
test("TC-031-02: archive_merged_reqs skips REQ when PR is OPEN", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-02-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const tcDir = join(tmpDir, "tasks", "test-cases");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(tcDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    makeReqFrontmatter({ reqId: "REQ-099", status: "review", prNumber: "42", tcRefs: ["TC-099-01"] }),
    "utf8",
  );
  await writeFile(join(tcDir, "TC-099-01.md"), makeTcFrontmatter("TC-099-01"), "utf8");

  const callLog = join(tmpDir, "calls.log");
  await createMockGh(mockBin, { "42": { state: "OPEN" } }, callLog);
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ and TC must remain untouched
    assert.ok(existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should still exist in features/");
    assert.ok(existsSync(join(tcDir, "TC-099-01.md")), "TC-099-01.md should still exist in test-cases/");
    assert.ok(!existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should NOT be in archive/done/");

    // No git commit
    const logExists = existsSync(callLog);
    if (logExists) {
      const log = await readFile(callLog, "utf8");
      assert.ok(!log.includes("commit"), `git commit should not have been called. calls.log:\n${log}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-031-03: PR is CLOSED (not merged) → no archiving
test("TC-031-03: archive_merged_reqs skips REQ when PR is CLOSED", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-03-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    makeReqFrontmatter({ reqId: "REQ-099", status: "review", prNumber: "42" }),
    "utf8",
  );

  const callLog = join(tmpDir, "calls.log");
  await createMockGh(mockBin, { "42": { state: "CLOSED" } }, callLog);
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.ok(existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should remain in features/");
    assert.ok(!existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should NOT be archived");

    const logExists = existsSync(callLog);
    if (logExists) {
      const log = await readFile(callLog, "utf8");
      assert.ok(!log.includes("commit"), `git commit should not have been called. calls.log:\n${log}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-031-04: Multiple TCs — all archived with status done
test("TC-031-04: archive_merged_reqs archives all associated TCs with status done", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-04-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const tcDir = join(tmpDir, "tasks", "test-cases");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(tcDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    makeReqFrontmatter({
      reqId: "REQ-099",
      status: "review",
      prNumber: "42",
      tcRefs: ["TC-099-01", "TC-099-02", "TC-099-03"],
    }),
    "utf8",
  );
  for (const tcId of ["TC-099-01", "TC-099-02", "TC-099-03"]) {
    await writeFile(join(tcDir, `${tcId}.md`), makeTcFrontmatter(tcId), "utf8");
  }

  const callLog = join(tmpDir, "calls.log");
  await createMockGh(mockBin, { "42": { state: "MERGED" } }, callLog);
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // All TCs archived with status done
    for (const tcId of ["TC-099-01", "TC-099-02", "TC-099-03"]) {
      assert.ok(existsSync(join(archiveDir, `${tcId}.md`)), `${tcId}.md should be in archive/done/`);
      assert.ok(!existsSync(join(tcDir, `${tcId}.md`)), `${tcId}.md should be removed from test-cases/`);
      const content = await readFile(join(archiveDir, `${tcId}.md`), "utf8");
      assert.ok(content.includes("status: done"), `${tcId} status should be done. Got:\n${content}`);
    }

    // REQ archived
    assert.ok(existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should be in archive/done/");
    const reqContent = await readFile(join(archiveDir, "REQ-099.md"), "utf8");
    assert.ok(reqContent.includes("status: done"), `REQ-099 status should be done. Got:\n${reqContent}`);

    // Single commit (one per REQ)
    const log = await readFile(callLog, "utf8");
    const commitLines = log.split("\n").filter((l) => l.includes("commit") && l.includes("archive(REQ-099)"));
    assert.equal(commitLines.length, 1, `Expected exactly one archive commit. calls.log:\n${log}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-031-05: gh fails for one REQ → skip it, continue and archive the other
test("TC-031-05: archive_merged_reqs skips REQ when gh fails and continues with others", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-05-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const tcDir = join(tmpDir, "tasks", "test-cases");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(tcDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  // REQ-098: gh will fail
  await writeFile(
    join(featuresDir, "REQ-098.md"),
    makeReqFrontmatter({ reqId: "REQ-098", status: "review", prNumber: "41" }),
    "utf8",
  );
  // REQ-099: gh will succeed (MERGED)
  await writeFile(
    join(featuresDir, "REQ-099.md"),
    makeReqFrontmatter({ reqId: "REQ-099", status: "review", prNumber: "42", tcRefs: ["TC-099-01"] }),
    "utf8",
  );
  await writeFile(join(tcDir, "TC-099-01.md"), makeTcFrontmatter("TC-099-01"), "utf8");

  const callLog = join(tmpDir, "calls.log");
  // gh: 41 exits with error, 42 returns MERGED
  const ghScript = `#!/usr/bin/env bash
echo "$*" >> "${callLog}"
pr_num=""
for arg in "$@"; do
  case "$arg" in [0-9]*) pr_num="$arg" ;; esac
done
case "$pr_num" in
  41) echo "GraphQL: Not Found" >&2; exit 1 ;;
  42) echo '{"state":"MERGED"}' ;;
  *) echo '{"state":"OPEN"}' ;;
esac
exit 0
`;
  await writeFile(join(mockBin, "gh"), ghScript, "utf8");
  await makeExecutable(join(mockBin, "gh"));
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    // Exit code must be 0 (heartbeat must not abort)
    assert.equal(result.code, 0, `bash should exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ-098 skipped (still in features/)
    assert.ok(existsSync(join(featuresDir, "REQ-098.md")), "REQ-098.md should still exist (skipped)");
    assert.ok(!existsSync(join(archiveDir, "REQ-098.md")), "REQ-098.md should NOT be archived");

    // WARN message about REQ-098
    assert.ok(
      result.stderr.includes("REQ-098") || result.stdout.includes("REQ-098"),
      `Expected WARN referencing REQ-098. stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );

    // REQ-099 archived successfully
    assert.ok(existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should be archived");
    const reqContent = await readFile(join(archiveDir, "REQ-099.md"), "utf8");
    assert.ok(reqContent.includes("status: done"), `REQ-099 status should be done. Got:\n${reqContent}`);
    assert.ok(existsSync(join(archiveDir, "TC-099-01.md")), "TC-099-01.md should be archived");
    const tcContent = await readFile(join(archiveDir, "TC-099-01.md"), "utf8");
    assert.ok(tcContent.includes("status: done"), `TC-099-01 status should be done. Got:\n${tcContent}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-031-06: Idempotent — no review REQs → no action, no error
test("TC-031-06: archive_merged_reqs is idempotent when no review REQs exist", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-06-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const archiveDir = join(tmpDir, "tasks", "archive", "done");
  const mockBin = join(tmpDir, "bin");
  await mkdir(featuresDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });
  await mkdir(mockBin, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });

  // Only a done REQ in archive (already archived) — nothing in features/
  await writeFile(
    join(archiveDir, "REQ-099.md"),
    makeReqFrontmatter({ reqId: "REQ-099", status: "done", prNumber: "42" }),
    "utf8",
  );

  const callLog = join(tmpDir, "calls.log");
  const ghScript = `#!/usr/bin/env bash
echo "GH_CALLED $*" >> "${callLog}"
echo '{"state":"MERGED"}'
exit 0
`;
  await writeFile(join(mockBin, "gh"), ghScript, "utf8");
  await makeExecutable(join(mockBin, "gh"));
  await createMockGit(mockBin, callLog);

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: join(tmpDir, "shared"),
        REPO_ROOT: tmpDir,
        PATH: `${mockBin}:${process.env.PATH ?? "/usr/bin:/bin"}`,
      },
    );

    assert.equal(result.code, 0, `bash should exit 0\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Already-archived file must not be modified
    assert.ok(existsSync(join(archiveDir, "REQ-099.md")), "REQ-099.md should remain in archive/done/");

    // gh and git must not be called (no review REQs in features/)
    const logExists = existsSync(callLog);
    if (logExists) {
      const log = await readFile(callLog, "utf8");
      assert.ok(!log.includes("GH_CALLED"), `gh should not be called. calls.log:\n${log}`);
      assert.ok(!log.includes("commit"), `git commit should not be called. calls.log:\n${log}`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-01 PR merged → triggers REQ + TC archive ──────────────────

test("TC-031-01: archive_merged_reqs — PR merged triggers REQ+TC archive with status:done", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-01-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const testCasesDir = join(tmpDir, "tasks", "test-cases");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(testCasesDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Test Archival\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: [TC-099-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );
  await writeFile(
    join(testCasesDir, "TC-099-01.md"),
    "---\ntc_id: TC-099-01\ntitle: Test TC\nreq_ref: REQ-099\nlayer: L1\ntype: functional\nstatus: ready\n---\n",
    "utf8",
  );

  // mock gh: returns MERGED
  await writeFile(join(binDir, "gh"), "#!/usr/bin/env bash\necho '{\"state\":\"MERGED\"}'\n", "utf8");
  await makeExecutable(join(binDir, "gh"));
  // mock git: logs calls, always exits 0
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ moved to archive, removed from features
    assert.ok(existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should be in archive/done/");
    assert.ok(!existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should be gone from features/");

    // TC moved to archive, removed from test-cases
    assert.ok(existsSync(join(archiveDoneDir, "TC-099-01.md")), "TC-099-01.md should be in archive/done/");
    assert.ok(!existsSync(join(testCasesDir, "TC-099-01.md")), "TC-099-01.md should be gone from test-cases/");

    // Both files have status: done
    const archivedReq = await readFile(join(archiveDoneDir, "REQ-099.md"), "utf8");
    assert.ok(archivedReq.includes("status: done"), `REQ should have status:done. Got:\n${archivedReq}`);
    const archivedTc = await readFile(join(archiveDoneDir, "TC-099-01.md"), "utf8");
    assert.ok(archivedTc.includes("status: done"), `TC should have status:done. Got:\n${archivedTc}`);

    // git commit called with correct message
    const gitLog = await readFile(gitCallLog, "utf8");
    assert.ok(
      gitLog.includes("archive(REQ-099): move to tasks/archive/done/"),
      `git commit message should match. Got:\n${gitLog}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-02 PR open → no archive ──────────────────────────────────

test("TC-031-02: archive_merged_reqs — PR open, no archive triggered", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-02-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const testCasesDir = join(tmpDir, "tasks", "test-cases");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(testCasesDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Test\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: [TC-099-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );
  await writeFile(
    join(testCasesDir, "TC-099-01.md"),
    "---\ntc_id: TC-099-01\ntitle: Test TC\nreq_ref: REQ-099\nlayer: L1\ntype: functional\nstatus: ready\n---\n",
    "utf8",
  );

  // mock gh: returns OPEN
  await writeFile(join(binDir, "gh"), "#!/usr/bin/env bash\necho '{\"state\":\"OPEN\"}'\n", "utf8");
  await makeExecutable(join(binDir, "gh"));
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ and TC must remain untouched
    assert.ok(existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should still be in features/");
    assert.ok(!existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should NOT be in archive/done/");

    const req = await readFile(join(featuresDir, "REQ-099.md"), "utf8");
    assert.ok(req.includes("status: review"), `REQ status should remain review. Got:\n${req}`);

    // git commit must NOT have been called
    assert.ok(!existsSync(gitCallLog) || !(await readFile(gitCallLog, "utf8")).includes("commit"),
      "git commit should not be called for OPEN PR",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-03 PR closed (not merged) → no archive ───────────────────

test("TC-031-03: archive_merged_reqs — PR closed (not merged), no archive triggered", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-03-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Test\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  // mock gh: returns CLOSED
  await writeFile(join(binDir, "gh"), "#!/usr/bin/env bash\necho '{\"state\":\"CLOSED\"}'\n", "utf8");
  await makeExecutable(join(binDir, "gh"));
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    assert.ok(existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should still be in features/");
    assert.ok(!existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should NOT be in archive/done/");

    assert.ok(
      !existsSync(gitCallLog) || !(await readFile(gitCallLog, "utf8")).includes("commit"),
      "git commit should not be called for CLOSED PR",
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-04 Multiple TCs → all archived with status:done ──────────

test("TC-031-04: archive_merged_reqs — multiple TCs all archived with status:done (BUG-005)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-04-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const testCasesDir = join(tmpDir, "tasks", "test-cases");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(testCasesDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  await writeFile(
    join(featuresDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Multi-TC Test\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: [TC-099-01, TC-099-02, TC-099-03]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );
  for (const tcId of ["TC-099-01", "TC-099-02", "TC-099-03"]) {
    await writeFile(
      join(testCasesDir, `${tcId}.md`),
      `---\ntc_id: ${tcId}\ntitle: Test TC\nreq_ref: REQ-099\nlayer: L1\ntype: functional\nstatus: ready\n---\n`,
      "utf8",
    );
  }

  await writeFile(join(binDir, "gh"), "#!/usr/bin/env bash\necho '{\"state\":\"MERGED\"}'\n", "utf8");
  await makeExecutable(join(binDir, "gh"));
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // All 3 TCs archived with status:done
    for (const tcId of ["TC-099-01", "TC-099-02", "TC-099-03"]) {
      assert.ok(existsSync(join(archiveDoneDir, `${tcId}.md`)), `${tcId}.md should be in archive/done/`);
      assert.ok(!existsSync(join(testCasesDir, `${tcId}.md`)), `${tcId}.md should be gone from test-cases/`);
      const content = await readFile(join(archiveDoneDir, `${tcId}.md`), "utf8");
      assert.ok(content.includes("status: done"), `${tcId} should have status:done. Got:\n${content}`);
    }

    // REQ archived with status:done
    assert.ok(existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should be in archive/done/");
    const archivedReq = await readFile(join(archiveDoneDir, "REQ-099.md"), "utf8");
    assert.ok(archivedReq.includes("status: done"), `REQ should have status:done. Got:\n${archivedReq}`);

    // Single git commit covering all files
    const gitLog = await readFile(gitCallLog, "utf8");
    assert.ok(
      gitLog.includes("archive(REQ-099): move to tasks/archive/done/"),
      `git commit message should match. Got:\n${gitLog}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-05 gh fails → skip REQ, heartbeat continues ──────────────

test("TC-031-05: archive_merged_reqs — gh failure skips REQ, heartbeat does not abort", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-05-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const testCasesDir = join(tmpDir, "tasks", "test-cases");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(testCasesDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  // REQ-098: gh will fail
  await writeFile(
    join(featuresDir, "REQ-098.md"),
    "---\nreq_id: REQ-098\ntitle: Fail Case\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 41\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );
  // REQ-099: gh will succeed (MERGED)
  await writeFile(
    join(featuresDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Success Case\nstatus: review\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: [TC-099-01]\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );
  await writeFile(
    join(testCasesDir, "TC-099-01.md"),
    "---\ntc_id: TC-099-01\ntitle: Test TC\nreq_ref: REQ-099\nlayer: L1\ntype: functional\nstatus: ready\n---\n",
    "utf8",
  );

  // mock gh: fail for PR 41, succeed for PR 42
  await writeFile(
    join(binDir, "gh"),
    `#!/usr/bin/env bash
if [[ "$*" == *"41"* ]]; then
  echo "GraphQL: Not Found" >&2
  exit 1
fi
echo '{"state":"MERGED"}'
`,
    "utf8",
  );
  await makeExecutable(join(binDir, "gh"));
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    // heartbeat must not abort on gh failure
    assert.equal(result.code, 0, `bash should exit 0 even with gh failure\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // REQ-098 must be skipped (still in features/)
    assert.ok(existsSync(join(featuresDir, "REQ-098.md")), "REQ-098.md should still be in features/ (skipped)");
    assert.ok(!existsSync(join(archiveDoneDir, "REQ-098.md")), "REQ-098.md should NOT be in archive/done/");

    // REQ-099 must be archived successfully
    assert.ok(existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should be in archive/done/");
    assert.ok(!existsSync(join(featuresDir, "REQ-099.md")), "REQ-099.md should be gone from features/");

    // warn logged for REQ-098
    assert.ok(
      result.stderr.includes("REQ-098") || result.stdout.includes("REQ-098"),
      `Should log warning about REQ-098. stderr: ${result.stderr}\nstdout: ${result.stdout}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-031: TC-031-06 Idempotent — already archived, no error ───────────────

test("TC-031-06: archive_merged_reqs — idempotent when no status:review REQs present", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-031-06-${Date.now()}`);
  const featuresDir = join(tmpDir, "tasks", "features");
  const archiveDoneDir = join(tmpDir, "tasks", "archive", "done");
  const binDir = join(tmpDir, "bin");
  const gitCallLog = join(tmpDir, "git_calls.log");

  await mkdir(featuresDir, { recursive: true });
  await mkdir(archiveDoneDir, { recursive: true });
  await mkdir(binDir, { recursive: true });

  // REQ is already in archive/done/ — not in features/
  await writeFile(
    join(archiveDoneDir, "REQ-099.md"),
    "---\nreq_id: REQ-099\ntitle: Already Archived\nstatus: done\npriority: P2\nphase: phase-2\nowner: menglan\npr_number: 42\nblocked_reason: \"\"\nblocked_from_status: \"\"\nblocked_from_owner: \"\"\ndepends_on: []\ntest_case_ref: []\ntc_policy: required\ntc_exempt_reason: \"\"\nscope: scripts\nacceptance: test\npending_bugs: []\n---\n",
    "utf8",
  );

  // mock gh and git — must NOT be called
  await writeFile(join(binDir, "gh"), `#!/usr/bin/env bash\necho "gh should not be called" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 1\n`, "utf8");
  await makeExecutable(join(binDir, "gh"));
  await writeFile(join(binDir, "git"), `#!/usr/bin/env bash\necho "$*" >> "\${GIT_CALL_LOG:-/dev/null}"\nexit 0\n`, "utf8");
  await makeExecutable(join(binDir, "git"));

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; archive_merged_reqs`,
      {
        SHARED_RESOURCES_ROOT: tmpDir,
        REPO_ROOT: tmpDir,
        PATH: `${binDir}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        GIT_CALL_LOG: gitCallLog,
      },
    );
    assert.equal(result.code, 0, `bash should exit 0 (idempotent)\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // archived file untouched
    assert.ok(existsSync(join(archiveDoneDir, "REQ-099.md")), "REQ-099.md should still be in archive/done/");

    // gh and git must not have been called (no status:review files in features/)
    assert.ok(
      !existsSync(gitCallLog),
      `Neither gh nor git should be called. gitCallLog exists with content: ${existsSync(gitCallLog) ? "yes" : "no"}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-039: TC-039-* 单 PR 规则 + Keep-Alive Watchdog ───────────────────────

// TC-039-01: inbox_write 第 10 参数 branch_name 写入 payload
test("TC-039-01: inbox_write with branch_name param writes branch_name to payload", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-01-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_write "menglan" "implement" "REQ-039" "test summary" "" "success" "" "" "" "feat/REQ-039"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "Expected .md file in for-menglan/pending/");
    const content = await readFile(join(pendingDir, files[0]!), "utf8");
    assert.ok(content.includes("branch_name: feat/REQ-039"), `Expected branch_name in payload. Got:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-01b: inbox_write without branch_name does NOT write branch_name field (backward compat)
test("TC-039-01b: inbox_write without branch_name omits branch_name field (backward compat)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-01b-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_write "menglan" "implement" "REQ-039" "test summary"`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "Expected .md file");
    const content = await readFile(join(pendingDir, files[0]!), "utf8");
    assert.ok(!content.includes("branch_name:"), `Expected no branch_name. Got:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-02: _handle_tc_complete forwards branch_name into implement message
test("TC-039-02: _handle_tc_complete(success) with branch_name writes branch_name to implement message", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-02-${Date.now()}`);
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039.md"),
    "---\nreq_id: REQ-039\nstatus: in_progress\nowner: claude_code\n---\n",
  );
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; _handle_tc_complete "REQ-039" "10" "success" "" "0" "feat/REQ-039"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "Expected implement message in for-menglan/pending/");
    const content = await readFile(join(pendingDir, files[0]!), "utf8");
    assert.ok(content.includes("branch_name: feat/REQ-039"), `Expected branch_name in implement message. Got:\n${content}`);
    assert.ok(content.includes("legacy_type: implement"), `Expected legacy_type: implement. Got:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-03: tc_complete dispatch extracts branch_name from message and passes to _handle_tc_complete
test("TC-039-03: inbox_read_pandas extracts branch_name from tc_complete and forwards to implement message", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-03-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-pandas", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-pandas", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039.md"),
    "---\nreq_id: REQ-039\nstatus: in_progress\nowner: claude_code\n---\n",
  );
  // tc_complete message with branch_name in payload
  await writeFile(
    join(tmpDir, "inbox", "for-pandas", "pending", "tc_complete_msg.md"),
    "---\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-23T00:00:00Z\npriority: P1\n---\nlegacy_type: tc_complete\nreq_id: REQ-039\npr_number: 10\nstatus: success\nbranch_name: feat/REQ-039\n",
  );
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "Expected implement message in for-menglan/pending/");
    const content = await readFile(join(pendingDir, files[0]!), "utf8");
    assert.ok(content.includes("branch_name: feat/REQ-039"), `Expected branch_name forwarded. Got:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-04: menglan implement handler passes EXISTING_BRANCH env var to harness.sh
test("TC-039-04: menglan-heartbeat implement handler passes EXISTING_BRANCH=feat/REQ-N to harness.sh", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-04-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "scripts"), { recursive: true });
  // Mock harness.sh: writes EXISTING_BRANCH value to a sentinel file
  const sentinelFile = join(tmpDir, "harness_existing_branch.txt");
  await writeFile(
    join(tmpDir, "scripts", "harness.sh"),
    `#!/usr/bin/env bash\necho "\${EXISTING_BRANCH:-UNSET}" > "${sentinelFile}"\nexit 0\n`,
  );
  await makeExecutable(join(tmpDir, "scripts", "harness.sh"));
  // implement message WITH branch_name
  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "impl_msg.md"),
    "---\ntype: request\naction: implement\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-23T00:00:00Z\npriority: P1\n---\nreq_id: REQ-039-eb\nsummary: impl test\nbranch_name: feat/REQ-039-eb\n",
  );
  try {
    const MENGLAN_SCRIPT = join(PROJECT_ROOT, "scripts/menglan-heartbeat.sh");
    const result = await runBash(
      `bash "${MENGLAN_SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `menglan-heartbeat failed: ${result.stderr}`);
    const sentinel = (await readFile(sentinelFile, "utf8")).trim();
    assert.equal(
      sentinel,
      "feat/REQ-039-eb",
      `Expected EXISTING_BRANCH=feat/REQ-039-eb passed to harness.sh. Got: ${sentinel}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-04b: implement without branch_name → EXISTING_BRANCH is empty (regression guard)
test("TC-039-04b: menglan-heartbeat implement without branch_name passes empty EXISTING_BRANCH", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-04b-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await mkdir(join(tmpDir, "scripts"), { recursive: true });
  const sentinelFile = join(tmpDir, "harness_existing_branch.txt");
  await writeFile(
    join(tmpDir, "scripts", "harness.sh"),
    `#!/usr/bin/env bash\necho "\${EXISTING_BRANCH:-UNSET}" > "${sentinelFile}"\nexit 0\n`,
  );
  await makeExecutable(join(tmpDir, "scripts", "harness.sh"));
  // implement message WITHOUT branch_name
  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "impl_msg_no_branch.md"),
    "---\ntype: request\naction: implement\nfrom: pandas\nto: menglan\ncreated_at: 2026-03-23T00:00:00Z\npriority: P1\n---\nreq_id: REQ-039-nob\nsummary: impl test no branch\n",
  );
  try {
    const MENGLAN_SCRIPT = join(PROJECT_ROOT, "scripts/menglan-heartbeat.sh");
    const result = await runBash(
      `bash "${MENGLAN_SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `menglan-heartbeat failed: ${result.stderr}`);
    const sentinel = (await readFile(sentinelFile, "utf8")).trim();
    assert.equal(
      sentinel,
      "UNSET",
      `Expected EXISTING_BRANCH to be empty/unset when branch_name absent. Got: ${sentinel}`,
    );
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-05: harness.sh cmd_worktree_setup fetches origin commits when worktree already exists
test("TC-039-05: harness.sh cmd_worktree_setup syncs origin commits when resuming existing worktree", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-05-${Date.now()}`);
  const originDir = join(tmpDir, "origin.git");
  const repoDir = join(tmpDir, "repo");
  const worktreeDir = join(tmpDir, "worktree");
  const huahuaCloneDir = join(tmpDir, "huahua-clone");
  try {
    // Set up bare origin and primary repo
    await runBash(`git init --bare "${originDir}"`);
    await runBash(
      `git -c user.email=test@test.com -c user.name=Test init "${repoDir}" && ` +
      `git -C "${repoDir}" -c user.email=test@test.com -c user.name=Test commit --allow-empty -m "init" && ` +
      `git -C "${repoDir}" remote add origin "${originDir}" && ` +
      `git -C "${repoDir}" push origin HEAD:main`,
    );
    // Create and push the feature branch (simulates Huahua opening TC PR)
    await runBash(
      `git -C "${repoDir}" checkout -b feat/REQ-039-fs && ` +
      `git -C "${repoDir}" -c user.email=test@test.com -c user.name=Test commit --allow-empty -m "TC design initial commit" && ` +
      `git -C "${repoDir}" push origin feat/REQ-039-fs && ` +
      `git -C "${repoDir}" checkout main`,
    );
    // Create worktree on this branch (simulates Menglan's first run)
    await runBash(`git -C "${repoDir}" worktree add "${worktreeDir}" feat/REQ-039-fs`);
    // Huahua pushes a new commit via a separate clone (branch is locked in worktree — must use separate clone)
    await runBash(
      `git clone "${originDir}" "${huahuaCloneDir}" && ` +
      `git -C "${huahuaCloneDir}" -c user.email=test@test.com -c user.name=Test checkout feat/REQ-039-fs && ` +
      `git -C "${huahuaCloneDir}" -c user.email=test@test.com -c user.name=Test commit --allow-empty -m "TC fix after review" && ` +
      `git -C "${huahuaCloneDir}" push origin feat/REQ-039-fs`,
    );
    // Verify worktree is behind origin (origin has new commit, worktree does not)
    const logBefore = await runBash(`git -C "${worktreeDir}" log --oneline`);
    assert.ok(
      !logBefore.stdout.includes("TC fix after review"),
      `Expected worktree to be behind origin before sync. Log:\n${logBefore.stdout}`,
    );
    // Run cmd_worktree_setup — should fetch and ff-merge the new commit into the worktree
    await runBash(
      `REPO_ROOT="${repoDir}" MENGLAN_WORKTREE_ROOT="${worktreeDir}" bash "${PROJECT_ROOT}/scripts/harness.sh" worktree-setup REQ-039-fs`,
    );
    // Worktree should now have Huahua's latest commit
    const logAfter = await runBash(`git -C "${worktreeDir}" log --oneline`);
    assert.ok(
      logAfter.stdout.includes("TC fix after review"),
      `Expected worktree to have latest origin commit after cmd_worktree_setup. Log:\n${logAfter.stdout}`,
    );
  } finally {
    await runBash(`git -C "${repoDir}" worktree remove --force "${worktreeDir}" 2>/dev/null || true`);
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-06: menglan-heartbeat writes runtime/menglan_alive.ts on every run
test("TC-039-08: menglan-heartbeat writes runtime/menglan_alive.ts on every run (including empty inbox)", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-08-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  try {
    const MENGLAN_SCRIPT = join(PROJECT_ROOT, "scripts/menglan-heartbeat.sh");
    const result = await runBash(
      `bash "${MENGLAN_SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    // exits 0 (empty inbox → early exit)
    assert.equal(result.code, 0, `menglan-heartbeat failed: ${result.stderr}`);
    const tsFile = join(tmpDir, "runtime", "menglan_alive.ts");
    assert.ok(existsSync(tsFile), "Expected runtime/menglan_alive.ts to exist");
    const content = (await readFile(tsFile, "utf8")).trim();
    assert.match(content, /^\d{10,}$/, `Expected epoch integer. Got: ${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-07: _check_stall_and_keepalive sends keep-alive for stale in_progress REQ
test("TC-039-09: _check_stall_and_keepalive sends keep-alive when menglan_alive.ts is stale", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-09-${Date.now()}`);
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await mkdir(join(tmpDir, "runtime"), { recursive: true });
  // REQ in progress owned by menglan
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039-stale.md"),
    "---\nreq_id: REQ-039-stale\nstatus: in_progress\nowner: menglan\npriority: P1\n---\n",
  );
  // alive timestamp 90 minutes ago
  const staleTs = Math.floor(Date.now() / 1000) - 90 * 60;
  await writeFile(join(tmpDir, "runtime", "menglan_alive.ts"), String(staleTs));
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; AGENT_STALL_TIMEOUT_MINUTES=60 _check_stall_and_keepalive`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(files.length > 0, "Expected keep-alive message in for-menglan/pending/");
    const content = await readFile(join(pendingDir, files[0]!), "utf8");
    assert.ok(content.includes("REQ-039-stale"), `Expected req_id in keep-alive. Got:\n${content}`);
    assert.ok(content.includes("keep-alive"), `Expected keep-alive summary. Got:\n${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-08: _check_stall_and_keepalive does NOT send keep-alive for fresh timestamp
test("TC-039-10: _check_stall_and_keepalive does NOT send keep-alive when menglan_alive.ts is fresh", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-10-${Date.now()}`);
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await mkdir(join(tmpDir, "runtime"), { recursive: true });
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039-fresh.md"),
    "---\nreq_id: REQ-039-fresh\nstatus: in_progress\nowner: menglan\npriority: P1\n---\n",
  );
  // alive timestamp 5 minutes ago (fresh)
  const freshTs = Math.floor(Date.now() / 1000) - 5 * 60;
  await writeFile(join(tmpDir, "runtime", "menglan_alive.ts"), String(freshTs));
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; AGENT_STALL_TIMEOUT_MINUTES=60 _check_stall_and_keepalive`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = existsSync(pendingDir) ? (await readdir(pendingDir)).filter((f) => f.endsWith(".md")) : [];
    assert.equal(files.length, 0, `Expected NO keep-alive message. Found: ${files.join(", ")}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-11: AGENT_STALL_TIMEOUT_MINUTES is configurable (30min threshold)
test("TC-039-11: AGENT_STALL_TIMEOUT_MINUTES=30 triggers keep-alive for 45min stale timestamp", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-11-${Date.now()}`);
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await mkdir(join(tmpDir, "runtime"), { recursive: true });
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039-cfg.md"),
    "---\nreq_id: REQ-039-cfg\nstatus: in_progress\nowner: menglan\npriority: P1\n---\n",
  );
  // alive timestamp 45 minutes ago
  const ts45 = Math.floor(Date.now() / 1000) - 45 * 60;
  await writeFile(join(tmpDir, "runtime", "menglan_alive.ts"), String(ts45));
  try {
    // With 30min threshold → stale → keep-alive sent
    const resultStale = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; AGENT_STALL_TIMEOUT_MINUTES=30 _check_stall_and_keepalive`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(resultStale.code, 0);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const staleFiles = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.ok(staleFiles.length > 0, "Expected keep-alive with 30min threshold");

    // Clean up pending dir for next sub-test
    for (const f of staleFiles) {
      await rm(join(pendingDir, f), { force: true });
    }

    // With default 60min threshold → fresh → no keep-alive
    const resultFresh = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; AGENT_STALL_TIMEOUT_MINUTES=60 _check_stall_and_keepalive`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(resultFresh.code, 0);
    const freshFiles = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    assert.equal(freshFiles.length, 0, "Expected NO keep-alive with 60min threshold for 45min stale");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-12: huahua-heartbeat writes runtime/huahua_alive.ts BEFORE empty-inbox exit
test("TC-039-12: huahua-heartbeat writes runtime/huahua_alive.ts even when inbox is empty", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-12-${Date.now()}`);
  await mkdir(join(tmpDir, "inbox", "for-huahua", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua", "failed"), { recursive: true });
  try {
    const HUAHUA_SCRIPT = join(PROJECT_ROOT, "scripts/huahua-heartbeat.sh");
    const result = await runBash(
      `bash "${HUAHUA_SCRIPT}"`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    // exits 0 (empty inbox → early exit)
    assert.equal(result.code, 0, `huahua-heartbeat failed: ${result.stderr}`);
    const tsFile = join(tmpDir, "runtime", "huahua_alive.ts");
    assert.ok(existsSync(tsFile), "Expected runtime/huahua_alive.ts to exist even with empty inbox");
    const content = (await readFile(tsFile, "utf8")).trim();
    assert.match(content, /^\d{10,}$/, `Expected epoch integer. Got: ${content}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-13: _check_stall_and_keepalive dedup — no duplicate keep-alive when one already pending
test("TC-039-13: _check_stall_and_keepalive does NOT send duplicate keep-alive when one already pending", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-13-${Date.now()}`);
  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await mkdir(join(tmpDir, "runtime"), { recursive: true });
  // REQ in progress owned by menglan
  await writeFile(
    join(tmpDir, "tasks", "features", "REQ-039-dedup.md"),
    "---\nreq_id: REQ-039-dedup\nstatus: in_progress\nowner: menglan\n---\n",
  );
  // Stale timestamp (90 min ago)
  const staleTs = String(Math.floor(Date.now() / 1000) - 90 * 60);
  await writeFile(join(tmpDir, "runtime", "menglan_alive.ts"), staleTs + "\n");
  // Pre-existing keep-alive already in pending
  await mkdir(join(tmpDir, "inbox", "for-menglan", "pending"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "claimed"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "done"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan", "failed"), { recursive: true });
  await writeFile(
    join(tmpDir, "inbox", "for-menglan", "pending", "existing-keepalive.md"),
    "---\ntype: request\naction: implement\nreq_id: REQ-039-dedup\nsummary: keep-alive: resume REQ-039-dedup\n---\n",
  );
  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; AGENT_STALL_TIMEOUT_MINUTES=60 _check_stall_and_keepalive`,
      { SHARED_RESOURCES_ROOT: tmpDir, REPO_ROOT: tmpDir },
    );
    assert.equal(result.code, 0);
    const pendingDir = join(tmpDir, "inbox", "for-menglan", "pending");
    const files = (await readdir(pendingDir)).filter((f) => f.endsWith(".md"));
    // Should still be exactly 1 — the pre-existing one, no new duplicate
    assert.equal(files.length, 1, `Expected exactly 1 keep-alive (no duplicate). Found: ${files.join(", ")}`);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── TC-039-06 / TC-039-07: harness.sh implement prompt — shared git setup helper ──────

/**
 * Set up a minimal git repo + pre-created worktree + REQ file + mock claude.
 * Returns { tmpDir, worktreeDir, promptCapture }.
 * The mock claude writes its last positional arg (the prompt string) to promptCapture.
 */
async function setupHarnessPromptTest(reqId: string): Promise<{ tmpDir: string; worktreeDir: string; promptCapture: string }> {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-039-hpt-${reqId}-${Date.now()}`);
  const worktreeDir = join(tmpDir, "worktree");
  const promptCapture = join(tmpDir, "captured_prompt.txt");

  await mkdir(join(tmpDir, "tasks", "features"), { recursive: true });
  await mkdir(join(tmpDir, "bin"), { recursive: true });

  // Minimal git repo so cmd_worktree_setup succeeds
  const branch = `feat/${reqId}`;
  await runBash(
    `git -c user.email=t@t.com -c user.name=T init "${tmpDir}" && ` +
    `git -C "${tmpDir}" -c user.email=t@t.com -c user.name=T commit --allow-empty -m "init" && ` +
    `git -C "${tmpDir}" checkout -b "${branch}" && ` +
    `git -C "${tmpDir}" -c user.email=t@t.com -c user.name=T commit --allow-empty -m "branch init" && ` +
    `git -C "${tmpDir}" checkout - && ` +
    `git -C "${tmpDir}" worktree add "${worktreeDir}" "${branch}"`,
  );

  // REQ file (FORCE=true bypasses claimable/depends checks)
  await writeFile(
    join(tmpDir, "tasks", "features", `${reqId}.md`),
    `---\nreq_id: ${reqId}\nstatus: test_designed\nowner: unassigned\ntc_policy: required\ndepends_on: []\n---\n`,
  );

  // Mock claude: capture last argument (the prompt) to a file and exit 0
  await writeFile(
    join(tmpDir, "bin", "claude"),
    `#!/usr/bin/env bash\nprintf '%s' "\${@: -1}" > "${promptCapture}"\nexit 0\n`,
  );
  await makeExecutable(join(tmpDir, "bin", "claude"));

  return { tmpDir, worktreeDir, promptCapture };
}

// TC-039-06: harness.sh cmd_implement with EXISTING_BRANCH → prompt contains PR-check note
test("TC-039-06: harness.sh implement with EXISTING_BRANCH — prompt contains gh pr list and gh pr edit", async () => {
  const reqId = "REQ-039-eb6";
  const { tmpDir, worktreeDir, promptCapture } = await setupHarnessPromptTest(reqId);
  try {
    const result = await runBash(
      `bash "${PROJECT_ROOT}/scripts/harness.sh" implement "${reqId}"`,
      {
        REPO_ROOT: tmpDir,
        MENGLAN_WORKTREE_ROOT: worktreeDir,
        FORCE: "true",
        EXISTING_BRANCH: `feat/${reqId}`,
        PATH: `${join(tmpDir, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    );
    assert.equal(result.code, 0, `harness.sh failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const prompt = await readFile(promptCapture, "utf8");
    assert.ok(
      prompt.includes(`gh pr list --head feat/${reqId}`),
      `Expected 'gh pr list --head feat/${reqId}' in prompt. Got:\n${prompt}`,
    );
    assert.ok(
      prompt.includes("gh pr edit"),
      `Expected 'gh pr edit' in prompt. Got:\n${prompt}`,
    );
    assert.ok(
      !prompt.includes("gh pr create --fill") || prompt.includes("If not found"),
      `Expected no unconditional 'gh pr create --fill' when EXISTING_BRANCH is set. Got:\n${prompt}`,
    );
  } finally {
    await runBash(`git -C "${tmpDir}" worktree remove --force "${worktreeDir}" 2>/dev/null || true`);
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// TC-039-07: harness.sh cmd_implement WITHOUT EXISTING_BRANCH → prompt uses gh pr create --fill (exempt/optional regression)
test("TC-039-07: harness.sh implement without EXISTING_BRANCH — prompt uses gh pr create --fill (tc_policy exempt/optional path)", async () => {
  const reqId = "REQ-039-ex7";
  const { tmpDir, worktreeDir, promptCapture } = await setupHarnessPromptTest(reqId);
  try {
    const result = await runBash(
      `bash "${PROJECT_ROOT}/scripts/harness.sh" implement "${reqId}"`,
      {
        REPO_ROOT: tmpDir,
        MENGLAN_WORKTREE_ROOT: worktreeDir,
        FORCE: "true",
        // EXISTING_BRANCH intentionally absent
        PATH: `${join(tmpDir, "bin")}:${process.env["PATH"] ?? ""}`,
      },
    );
    assert.equal(result.code, 0, `harness.sh failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    const prompt = await readFile(promptCapture, "utf8");
    // Without EXISTING_BRANCH the PR-exists note is absent, so Claude follows standard PR create flow
    assert.ok(
      !prompt.includes("gh pr list --head"),
      `Expected no 'gh pr list --head' in prompt when EXISTING_BRANCH absent. Got:\n${prompt}`,
    );
    assert.ok(
      !prompt.includes("gh pr edit"),
      `Expected no 'gh pr edit' instruction in prompt when EXISTING_BRANCH absent. Got:\n${prompt}`,
    );
    assert.ok(
      !prompt.includes("A TC PR already exists"),
      `Expected no 'A TC PR already exists' note in prompt when EXISTING_BRANCH absent. Got:\n${prompt}`,
    );
  } finally {
    await runBash(`git -C "${tmpDir}" worktree remove --force "${worktreeDir}" 2>/dev/null || true`);
    await rm(tmpDir, { recursive: true, force: true });
  }
});
