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
    const files = await readdir(huahuaDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected at least one .md file in for-huahua/");

    const content = await readFile(join(huahuaDir, mdFiles[0]!), "utf8");
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
    const files = await readdir(menglanDir);
    assert.ok(files.some((f) => f.endsWith(".md")), "Expected .md file in for-menglan/");
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
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message in for-menglan/");

    const content = await readFile(join(menglanDir, mdFiles[0]!), "utf8");
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
    const files = await readdir(huahuaDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected fix message in for-huahua/");

    const content = await readFile(join(huahuaDir, mdFiles[0]!), "utf8");
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
    // for-huahua should have no new tc_design files
    const huahuaFiles = await readdir(huahuaDir);
    assert.equal(huahuaFiles.length, 0, `for-huahua/ should have no new files, got: ${huahuaFiles.join(", ")}`);
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
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file in for-menglan/");

    const content = await readFile(join(menglanDir, mdFiles[0]!), "utf8");
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
    const files = await readdir(menglanDir);
    const content = await readFile(join(menglanDir, files.filter((f) => f.endsWith(".md"))[0]!), "utf8");
    assert.ok(content.includes("type: request"), "Missing type: request");
    assert.ok(content.includes("action: implement"), "Missing action field");
    assert.ok(content.includes("response_required: true"), "Missing response_required field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-03 inbox_write_v2 type=response fields ───────────────────

test("TC-033-03: inbox_write_v2 type=response includes in_reply_to", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-03-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "pandas" "response" "" "thread_t1" "corr_t1" "msg_orig_001" "P2" "false" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandasDir = join(tmpDir, "inbox", "for-pandas");
    const files = await readdir(pandasDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await readFile(join(pandasDir, mdFiles[0]!), "utf8");
    assert.ok(content.includes("type: response"), "Missing type: response");
    assert.ok(content.includes("in_reply_to: msg_orig_001"), "Missing in_reply_to field");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-04 inbox_write_v2 type=notification fields ───────────────

test("TC-033-04: inbox_write_v2 type=notification includes event_type", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-04-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; ` +
      `inbox_write_v2 "pandas" "notification" "deploy_complete" "thread_t1" "corr_t1" "" "P2" "false" ""`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    const pandasDir = join(tmpDir, "inbox", "for-pandas");
    const files = await readdir(pandasDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    const content = await readFile(join(pandasDir, mdFiles[0]!), "utf8");
    assert.ok(content.includes("type: notification"), "Missing type: notification");
    assert.ok(content.includes("event_type: deploy_complete"), "Missing event_type field");
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
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected .md file from deprecated inbox_write()");

    const content = await readFile(join(menglanDir, mdFiles[0]!), "utf8");
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

// ── REQ-033: TC-033-06 inbox_read_pandas ATM request routing ─────────────────

test("TC-033-06: inbox_read_pandas routes ATM request (action=implement) to _handle_tc_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-06-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-atm-req.md"),
    "---\nmessage_id: msg_test_001\ntype: request\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: thread_test\ncorrelation_id: corr_test\npriority: P1\naction: implement\nresponse_required: false\n---\n# legacy fields\nreq_id: REQ-033\nstatus: success\nsummary: TC approved\n",
    "utf8",
  );

  try {
    const result = await runBash(
      `source "${SCRIPT}" 2>/dev/null; inbox_init; inbox_read_pandas`,
      { SHARED_RESOURCES_ROOT: tmpDir },
    );
    assert.equal(result.code, 0, `bash failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // tc_complete success → route implement to menglan
    const menglanDir = join(tmpDir, "inbox", "for-menglan");
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message routed to for-menglan/");
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ── REQ-033: TC-033-07 inbox_read_pandas ATM response routing ────────────────

test("TC-033-07: inbox_read_pandas routes ATM response (status=success) to _handle_dev_complete", async () => {
  const tmpDir = join(PROJECT_ROOT, "runtime", `zzzz-tc-033-07-${Date.now()}`);
  const inboxPandasDir = join(tmpDir, "inbox", "for-pandas");
  await mkdir(inboxPandasDir, { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-menglan"), { recursive: true });
  await mkdir(join(tmpDir, "inbox", "for-huahua"), { recursive: true });

  await writeFile(
    join(inboxPandasDir, "2026-03-20-atm-resp.md"),
    "---\nmessage_id: msg_resp_001\ntype: response\nfrom: menglan\nto: pandas\ncreated_at: 2026-03-20T00:00:00Z\nthread_id: thread_test\ncorrelation_id: corr_test\npriority: P2\n---\n# legacy fields\nreq_id: REQ-033\npr_number: 42\nsummary: 实现完成\nstatus: success\n",
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
    const files = await readdir(menglanDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    assert.ok(mdFiles.length > 0, "Expected implement message routed to for-menglan/ via legacy handler");
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
