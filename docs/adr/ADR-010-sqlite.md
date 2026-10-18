# ADR-010 SQLite, not Postgres

## Context
The runtime needs to persist intents, approvals, contacts, memory, spend history and attack runs. A prototype should be trivial to run from a clean clone.

## Decision
Use SQLite via the Node 22 built-in `node:sqlite` module. The audit log is a separate append-only JSONL file.

## Alternatives considered
- Postgres: needs a running server, which is friction for a judge cloning the repo.
- A native SQLite addon (better-sqlite3): needs a compiler toolchain on install.

## Consequences
A clean clone needs no database server and no compiler. Node prints an experimental-feature warning for `node:sqlite`, which is acceptable for a single-process prototype. The trade-off is that SQLite is single-writer and not meant for a multi-instance deployment; a real service would move to Postgres, which is a schema port, not a redesign.
