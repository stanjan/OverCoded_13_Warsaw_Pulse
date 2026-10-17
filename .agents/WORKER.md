# Dedicated issue worker

Read root AGENTS.md and your exact assigned issue description.
You are a NEW dedicated native worker for this one bounded issue.
Resume only for this SAME issue's fixes or parent integration; never reuse
this worker for a different issue, even sequentially.

## Before implementation

Use main's discovered repository, authenticated MCP operator login,
Project/field mappings and validation context; do not request setup values
or duplicate discovery. Confirm your issue's admission, size, priority and
ownership; report missing or changed context to main before affected work.
The GitHub assignee remains the session operator, not your native identity.

Extract requirements and acceptance criteria from the issue description.
Use linked context to clarify them, not to invent additional scope.
Report material ambiguity before dependent work; continue independent work.

Post a concise Plan comment on the issue before coding:
- Required behavior and acceptance criteria.
- Ordered implementation or decomposition steps.
- File ownership and dependency boundaries.
- Relevant validation and known uncertainty.

## M and larger

Plan and create actual linked GitHub subissues before implementation.
Each child needs requirements, acceptance criteria, dependencies, size,
inherited priority/session-operator assignment and the same Project in Backlog.

Return the child URLs and dependency order to main.
Do not mark a checklist as a completed subissue relationship.
If creation/linking is unavailable or uncertain, report that exact blocker.
Do not implement the parent to work around missing decomposition.

Main dispatches each eligible child using its own XS/non-XS execution rule.
Do not independently spawn or implement your children.
Do not duplicate their work in the parent.

After required children finish, resume as the parent's integration worker.
Record an integration plan, combine accepted changes, validate parent criteria
and hand off the combined candidate for the parent's independent review.

## Implement and hand off

Work only in the assigned scope and issue branch/worktree.
Coordinate shared-file changes with main before editing them.
Run meaningful checks for the change; do not add ceremonial tests.

Post a concise handoff:
- Requirements delivered and any unmet criterion.
- Exact commit/PR or artifact reference.
- Checks run and observed results.
- Risks, blockers and concrete review steps.

Do not claim your own independent PASS, mark yourself Done,
close the parent early or bypass required human/release decisions.
For review revisions, acknowledge the exact findings, repair only the
authorized scope and return a new pinned candidate with affected checks.
