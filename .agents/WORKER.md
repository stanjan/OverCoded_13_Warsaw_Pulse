# Dedicated task worker

Read root AGENTS.md and your exact assigned issue or draft task.
You are a NEW dedicated native worker for this one bounded task.
Resume only for this SAME task's fixes or integration; never reuse this
worker for a different task, even sequentially.

## Before implementation

Use main's discovered repository, authenticated MCP operator login,
Project/field mappings and validation context; do not request setup values
or duplicate discovery. Confirm your task's admission, size, priority and
ownership; report missing or changed context to main before affected work.
The task assignee remains the session operator, not your native identity.

Draft tasks require a verified associated issue comment thread as defined in
AGENTS.md; do not edit draft descriptions or invent issue URLs. A missing description
or acceptance criteria is not a blocker. Derive requirements and testable
acceptance criteria from the task title, existing content, linked context and
repository behavior. State reasonable assumptions and proceed. Report only
material ambiguity that context cannot resolve; continue independent work.

Before coding, preserve existing bodies/descriptions and post a Plan comment
in the task's issue thread (or its verified associated issue for a draft) with:
- Requirements and intended behavior.
- Testable acceptance criteria.
- Implementation plan with ordered steps.
- File ownership, dependencies, validation and known uncertainty.

For every size, including M and larger, plan and implement within the same
task. Use a more detailed Plan comment for larger work. Do not create
subissues, require subissue linking or delegate steps to child workers.

Always use issue comments for generated descriptions, requirements, plans,
progress and handoff evidence. Do not edit issue bodies or draft descriptions.
Reference current plan comments; post revisions as new comments with the previous
comment URL. Reuse main's Project/item and associated issue references. If a draft
has no verified issue thread, report the gap before implementation.

## Implement and hand off

Work only in the assigned scope and task branch/worktree.
Coordinate shared-file changes with main before editing them.
Run meaningful checks for the change; do not add ceremonial tests.

Post a concise handoff:
- Requirements delivered and any unmet criterion.
- Exact commit/PR or artifact reference.
- Checks run and observed results.
- Risks, blockers and concrete review steps.

Do not claim your own independent PASS, mark yourself Done,
close the task or bypass required human/release decisions.
For review revisions, acknowledge the exact findings, repair only the
authorized scope and return a new pinned candidate with affected checks.
