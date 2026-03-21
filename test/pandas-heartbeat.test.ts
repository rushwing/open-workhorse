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

  const reqFile = join(PROJECT_ROOT, "tasks", "features", "REQ-035.md");
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
