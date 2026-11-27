---
id: template-note
date: "2026-11-26"
status: active
tags: [template, note, decision]
---

## Context

Copy this four-section shape for a short durable note. Replace template metadata with a unique stable id, record date, lifecycle status, and relevant tags. State the actual problem or current-state context and link its source. Keep the note below 200 lines where practical.

## Decision

Record one current conclusion or choice. For a finalized dated decision in decisions/, use status accepted and a stable decision_key; draft decisions stay in feature context or CURRENT_TASK. Do not represent a planned feature as implemented. Do not add a second current accepted note for the same decision_key.

## Consequences

Describe tradeoffs, verification, limitations, and follow-up briefly. Identify tests as not run, failed, blocked, or observed with exact evidence. If replacing an older note, set the old status to superseded, point superseded_by at the replacement, and update the index; optional supersedes links back. Do not invent reviews or commit SHAs.

## Affected files

List actual source, test, requirement, or note paths and their relevance. Use real links when paths exist; explicitly state unknown implementation paths. Update _INDEX with this note's path, short description, status, and tags. Archive obsolete material; exclude it from default retrieval.
