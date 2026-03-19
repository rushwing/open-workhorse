-- Pandas Agent Team — Long-Term Memory Schema
-- Version: v0 (2026-03-19)
-- Runtime file: project.db (gitignored)
-- Source of truth: this file

-- Curated stable truths about the project.
-- Facts that rarely change and apply across many tasks.
CREATE TABLE IF NOT EXISTS project_facts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    topic        TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    source_agent TEXT    NOT NULL,
    created_at   TEXT    NOT NULL DEFAULT (date('now'))
);

-- Architectural and design decisions archive.
-- Queryable by date or topic for context reconstruction.
CREATE TABLE IF NOT EXISTS decisions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT    NOT NULL,
    decision    TEXT    NOT NULL,
    rationale   TEXT,
    made_by     TEXT    NOT NULL,
    date        TEXT    NOT NULL
);

-- Recurring review or implementation patterns.
-- Agents may query this before starting a task to surface known risk clusters.
CREATE TABLE IF NOT EXISTS patterns (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT    NOT NULL,
    agent        TEXT    NOT NULL,
    description  TEXT    NOT NULL,
    example      TEXT,
    created_at   TEXT    NOT NULL DEFAULT (date('now'))
);

-- Curation queue status mirror for candidate files in short-term/candidates/.
-- Allows SQL queries on the proposal queue without filesystem enumeration.
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
