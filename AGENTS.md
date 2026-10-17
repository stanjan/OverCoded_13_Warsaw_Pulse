# Hackathon agent workflow

## Runtime discovery — no setup file required

Main discovers the working context at session start; do not ask the user to
fill repository, login, Project or field placeholders.

1. Read the current directory's Git root, branch tracking remote and remotes
   using ordinary local Git reads. Resolve SSH/HTTPS GitHub URLs and verify
   the exact repository through available GitHub MCP capabilities. Prefer an
   explicit task repository consistent with this checkout; otherwise use an
   unambiguous branch upstream or origin. Fork/upstream alternatives, multiple
   targets or a missing GitHub remote require a narrow question, not a guess.
2. Use GitHub MCP's authenticated current-user result as the session operator
   login directly. Do not routinely ask for confirmation or infer it from Git
   author settings, OS login, repository owner or a native agent name.
   Resolve only an explicit conflicting user instruction or actual ambiguity
   between authenticated accounts before account-dependent work.
3. Discover the repository's applicable GitHub Projects through MCP. Honor
   an explicit current Project context; otherwise use the unique applicable
   repository-linked Project. Ask narrowly when multiple choices remain.
   Read actual Project, field and option IDs for status, priority and size.
   Map existing Ready/Backlog/active/review/Done states and P0/P1/P2 and size
   options using actual schema and repository guidance. Never invent IDs,
   guess ambiguous meanings or create/alter a Project schema to fit this kit.
4. Discover validation commands from repository instructions, package scripts,
   build files and CI. Use at most two concurrent execution issues by default,
   reduced by repository policy or native capacity.

Unavailable required discovery or MCP capability blocks only affected work;
report the exact missing information/capability and ask one useful question
when the user can resolve it. Continue independent permitted work.
Pass the verified repository, operator login, Project/field mappings and
validation context to each worker/reviewer. They reuse it without setup
prompts or repeating discovery; recheck affected context if it changes.

## Source of truth and tool boundary

GitHub issues and the discovered GitHub Project are the sole task ledger.
Use the connected GitHub Projects MCP capabilities for issue/project reads,
comments, assignments, status changes and actual subissue relationships.
Do not substitute local TODO files, a second board, shell GitHub commands
or a Markdown checklist for GitHub task records or linked subissues.

Source branches, commits and PRs contain implementation and reviewable code.
They are not a second task ledger. Keep progress evidence concise on the issue.

The authenticated GitHub MCP current-user login is the session operator.
Native agents inherit that verified login as task context;
never assign an issue to a fictional agent account.

If a required MCP capability is unavailable, report the exact limitation.
Do not claim that a comment/checklist created actual linked subissues,
or that a failed/uncertain write succeeded. Reconcile before retrying.

## Eligible work

The main agent schedules work. Admit an issue only when all are true:

1. It belongs to the discovered repository and Project.
2. It is open and its Project status is Ready, not Backlog.
3. Its GitHub assignees include the verified human session operator.
4. Its priority and size are present and recognized.
5. Its blocking dependencies are complete.
6. No executor already owns an active run of that issue.

Recheck eligibility immediately before starting.
Missing fields, unclear ownership or unmet dependencies make that issue
ineligible; report the specific reason and consider other eligible issues.
Do not change an unrelated issue's assignee or promote Backlog work
merely to make it eligible.

Record the native executor/run in an issue comment before work starts.
Then move the admitted issue to In progress.
An already admitted issue can continue in its active status; it does not
need to remain Ready. Stop affected work if scope or ownership is revoked.

## Priority and parallelism

Choose among eligible, unclaimed issues in this order:

1. P0 before P1 before P2.
2. Within the same priority, oldest issue creation timestamp first.
3. If timestamps tie, lowest issue number first.

Use this same order whenever a slot becomes available.
Active work is not restarted or interrupted when a higher priority arrives.
Blocked or already active parent issues do not prevent eligible children
from being selected. Do not start lower priority work while an eligible
higher priority issue can use that execution slot.

After each completion or handoff, re-read the eligible Ready queue and
continue until no eligible work remains. If workers or reviewers are still
active, wait using native agent tools, collect their results and reassess
the queue before ending the session.

Parallel source edits require separate issue branches/worktrees when Git
is available. Reconcile shared-file ownership before concurrent editing.
Do not merge first and resolve predictable ownership conflicts later.

## Execution and review by size

Every executor records a short issue plan before writing implementation,
including XS work. Plans derive requirements from the issue description.

- XS: the main agent plans, implements, validates and self-reviews directly.
- S and larger: create a NEW dedicated native worker for that issue.
  After its handoff, assign a different native reviewer.
- M and larger: the dedicated worker first plans and creates actual linked
  GitHub subissues before any implementation. Follow the decomposition rules.

Use `.agents/WORKER.md` for workers and `.agents/REVIEWER.md` for reviewers.
Give each the exact issue URL, operator login, requirements, owned files,
dependencies, expected output and validation commands.
Resume that worker only for the SAME issue's fixes or parent integration.
Never reuse it for a different issue, even sequentially.

A worker never reviews its own issue.
The main agent's XS self-review is explicitly self-review.
Do not call it independent review or use it to waive another issue's review.

## M+ decomposition and parent lifecycle

The M+ worker owns planning/decomposition first, then parent integration.
It creates real child issues linked with GitHub's subissue relationship.
Each child must contain bounded requirements, acceptance criteria,
dependencies, explicit scope and a legitimate size.

Children inherit the verified human assignee and parent priority.
Add them to the same Project in Backlog initially.
Prefer XS/S implementation leaves. If a child is still M+, its own dedicated
worker must recursively decompose it before implementation.
Do not disguise substantial work as XS to avoid delegation or review.

The main agent verifies the proposed children and their dependencies.
It may explicitly move an approved child to Ready when its prerequisites
are satisfied; this does not authorize promoting unrelated backlog work.
Then schedule children using the normal eligibility and priority rules.

The parent worker must not implement work assigned to children.
While children execute, the parent remains active and waits without
occupying an execution slot. Its worker may be resumed for integration.
Children do not become eligible merely because the parent is active.

When all required children are Done, the parent worker plans the remaining
integration step, combines their accepted changes and validates the parent
acceptance criteria. New substantial scope becomes another child issue.
The non-XS parent receives its own distinct integration review against
the combined candidate; child reviews alone do not complete the parent.

## Completion and communication

For each issue, retain the plan, implementation/commit or PR reference,
validation outcome and review verdict in concise GitHub comments.
State failures, uncertainty and remaining gates plainly.

For XS, main records its self-review before Done.
For non-XS, move to In review and obtain a current PASS from its distinct
reviewer before integration/completion.
Changes that invalidate a review require fresh review of the new candidate.
Unchanged evidence may be reused with its exact reference and limits.

Main integrates accepted work serially, resolves integration failures
and verifies the issue acceptance criteria before marking Done/closing.
A parent cannot be Done while required children remain incomplete.
Do not fabricate human approval, deployment, test results or delivery.
Preserve any separately required human or release gate.

Report completed issues, active work, actual blockers and the next action.
Keep checks proportionate; repeat passing suites only for changed code,
a failure, an unresolved concern or a necessary integration check.
