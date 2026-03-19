---
doc_id: memory-architecture-v0
purpose: Two-layer memory system for the Pandas Agent Team in open-workhorse
load_when:
  - implementing memory-related capabilities
  - onboarding a new agent workspace
  - auditing memory access patterns
avoid_loading_when:
  - active task execution without a memory-related concern
owner: pandas_team
status: v0
---

# Memory Architecture — Pandas Team (v0)

Summarizes the two-layer memory system from `everything_openclaw/docs/memory_architecture_v0.md`.
Schema source: `everything_openclaw/personas/workspace-pandas/memory/long-term/schema.sql`

## Two-Layer Overview

| Layer | Mechanism | Owner | Purpose |
|---|---|---|---|
| Short-term | Structured Markdown Folders | Specialists write; Pandas curates | Session notes, memory proposals, ground-truth project docs |
| Long-term | SQLite (`project.db`) | Pandas writes; all agents read | Accumulated curated facts, decisions, patterns |

**Design Rationale**

- Folders are transparent, diff-able, and readable by any agent with file access.
- SQLite provides structured, queryable long-term memory without external services.
- Specialists write freely to short-term surfaces; Pandas is the single curation authority for long-term storage.

---

## Folder Structure

```
workspace-pandas/memory/          ← Pandas-owned, curated
├── MEMORY.md                     ← Shared index — Pandas writes, all agents read
├── short-term/
│   ├── sessions/                 ← Specialist daily notes
│   │   └── YYYY-MM-DD-{agent}.md
│   └── candidates/               ← Memory proposals queue (specialists write, Pandas curates)
│       └── YYYY-MM-DD-{agent}-{topic}.md
├── projects/                     ← Ground truth (Pandas writes, all agents read)
│   ├── goals.md
│   ├── decisions.md
│   └── current-status.md
└── long-term/
    ├── schema.sql                ← Table definitions (version-controlled, from everything_openclaw)
    └── project.db                ← SQLite: patterns + curated facts (runtime, .gitignored)

workspace-huahua/memory/
├── MEMORY.md
└── sessions/

workspace-menglan/memory/
├── MEMORY.md
└── sessions/
```

---

## Write Authority Table

| Action | Meng Lan | Hua Hua | Pandas |
|---|---|---|---|
| Write own `sessions/` | ✓ | ✓ | ✓ |
| Write `short-term/candidates/` | ✓ | ✓ | ✓ |
| Read `projects/` ground truth | ✓ read | ✓ read | ✓ write |
| Read `long-term/project.db` (SELECT) | ✓ | ✓ | ✓ |
| Write `long-term/project.db` (INSERT/UPDATE) | ✗ | ✗ | ✓ |
| Curate candidates → SQLite | ✗ | ✗ | ✓ |
| Write `MEMORY.md` shared index | ✗ | ✗ | ✓ |

---

## SQLite Schema

File: `workspace-pandas/memory/long-term/schema.sql`
Source of truth: `everything_openclaw/personas/workspace-pandas/memory/long-term/schema.sql`

### Table: `project_facts`

Curated stable truths about the project.

```sql
CREATE TABLE IF NOT EXISTS project_facts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic        TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    source_agent TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (date('now'))
);
```

### Table: `decisions`

Architectural and design decisions archive.

```sql
CREATE TABLE IF NOT EXISTS decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    decision    TEXT    NOT NULL,
    rationale   TEXT,
    made_by     TEXT    NOT NULL,
    date        TEXT    NOT NULL
);
```

### Table: `patterns`

Recurring review or implementation patterns.

```sql
CREATE TABLE IF NOT EXISTS patterns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT    NOT NULL,
    agent        TEXT    NOT NULL,
    description  TEXT    NOT NULL,
    example      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (date('now'))
);
```

### Table: `candidates`

Curation queue status mirror for candidate files.

```sql
CREATE TABLE IF NOT EXISTS candidates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_agent TEXT    NOT NULL,
    topic        TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending'
                         CHECK(status IN ('pending', 'accepted', 'rejected')),
    proposed_at  TEXT    NOT NULL,
    reviewed_at  TEXT
);
```

---

## Curation Trigger

Pandas curates candidates from `short-term/candidates/` into SQLite at one of:

1. **Session end** — after routing a result packet and before closing the session
2. **After completing a batch of work items** — when candidates have accumulated

Curation steps:
1. Read each `pending` candidate file
2. Evaluate relevance, durability, and category
3. Insert accepted candidates into the appropriate `project.db` table
4. Update candidate `status` to `accepted` or `rejected`
5. Update `MEMORY.md` shared index if the curated fact changes the team's operating knowledge

See Template L in `agent-cli-playbook.md` for the automated curation invocation.

---

## Read Policy Per Agent

### Specialists (Meng Lan, Hua Hua)

1. Start with the active task packet
2. Read `~/workspace-pandas/memory/MEMORY.md` for stable project facts
3. Read `~/workspace-pandas/memory/projects/` if the task references project goals or current state
4. Query `project.db` via SELECT for durable patterns or past decisions
5. Write session notes to own `sessions/` directory
6. Propose durable lessons via candidate files or result packet `memory_candidate` field

### Pandas

1. Read own `MEMORY.md` and all `projects/` files at session start
2. Read candidate queue from `short-term/candidates/` before curation
3. Write to `project.db` only after evaluation
4. Keep `MEMORY.md` and `projects/` as the authoritative shared surface

---

## Initialization

```bash
npm run memory:init
# Validates workspace-pandas/memory/ structure and creates project.db
# Requires: everything_openclaw cloned at ~/workspace-pandas/everything_openclaw
# Requires: sqlite3 installed (apt install sqlite3)
```

---

## Capability-to-Path Mapping

| Capability | Agent | Path |
|---|---|---|
| `mem-project-read_shared_memory` | all | `~/workspace-pandas/memory/MEMORY.md` |
| `mem-longterm-query_knowledge` | all | `~/workspace-pandas/memory/long-term/project.db` (SELECT only) |
| `mem-longterm-write_knowledge` | Pandas only | `~/workspace-pandas/memory/long-term/project.db` (INSERT/UPDATE) |

---

## Invariants

1. `project.db` is never committed to git. It is a runtime artifact.
2. Specialists never write to `~/workspace-pandas/memory/` directly — only via candidate proposal path.
3. Memory does not block task completion. If shared memory is unavailable, proceed from the task packet.
4. `schema.sql` is the version-controlled source of truth for the database schema.
