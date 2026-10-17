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
   build files and CI. Use at most two concurrent execution tasks by default,
   reduced by repository policy or native capacity.

Unavailable required discovery or MCP capability blocks only affected work;
report the exact missing information/capability and ask one useful question
when the user can resolve it. Continue independent permitted work.
Pass the verified repository, operator login, Project/field mappings and
validation context to each worker/reviewer. They reuse it without setup
prompts or repeating discovery; recheck affected context if it changes.

## Source of truth and tool boundary

GitHub issues and draft items in the discovered GitHub Project are the sole
task ledger. Both are tasks throughout these instructions.
Use connected GitHub MCP capabilities for task/project reads, comments,
assignments and status changes. Keep existing issue bodies and draft descriptions
unchanged; all agent-generated task descriptions and execution records go in
issue comments. Follow the draft comment limitation below.
Do not substitute local TODO files, a second board or shell GitHub commands
for GitHub task records. Implementation steps belong in the task's issue comment thread.
Do not create or require subissues.

Source branches, commits and PRs contain implementation and reviewable code.
They are not a second task ledger. Keep progress evidence concise on the task.
Always use issue comments for generated requirements, acceptance criteria,
implementation plans, executor/run records, progress, handoffs and reviews.
Read existing bodies/descriptions as context; never edit them for this workflow.
Add a new comment for revisions, referring to the superseded comment URL.
Pass the current requirements/plan comment URLs to workers and reviewers.

Draft items have no comment thread. A draft may use an existing explicitly
associated repository issue's comment thread when the relationship is verified;
keep its Project fields on the draft and reference both records in comments.
Do not attach notes to an unrelated issue. If no associated issue exists, report
that a comment-capable issue is needed before execution. Do not attempt draft
body edits, silently convert the draft or create a companion issue without user
authorization. Draft read/status operations remain available independently.

The authenticated GitHub MCP current-user login is the session operator.
Native agents inherit that verified login as task context;
never assign a task to a fictional agent account.

If a required MCP capability is unavailable, report the exact limitation.
Do not claim a failed/uncertain write succeeded. Reconcile before retrying.
Missing subissue tools are not a blocker because this workflow uses no subissues.

## Eligible work

The main agent schedules work. Admit an issue or draft task only when all are true:

1. It belongs to the discovered Project and repository scope. For issues,
   verify the repository directly. For drafts without a repository field,
   establish scope from the title, description and applicable Project context;
   ask only if the repository remains ambiguous.
2. Its Project status is Ready, not Backlog; an issue must also be open.
3. Its assignees include the verified human session operator (issue assignees
   for issues, the Project Assignees field for drafts).
4. Its priority and size are present and recognized.
5. Its blocking dependencies are complete.
6. No executor already owns an active run of that task.

Recheck eligibility immediately before starting.
Missing scheduling fields (status, assignee, priority or size), unclear ownership
or unmet dependencies make that task ineligible; report the specific reason
and consider other eligible tasks. A missing description or acceptance criteria
does not make a task ineligible: generate them before implementation.
Do not change an unrelated task's assignee or promote Backlog work
merely to make it eligible.

Record the native executor/run before work starts in the task's issue comment
thread (or its verified associated issue for a draft). Then move the admitted task to
In progress. An already admitted task can continue in its active status; it does not
need to remain Ready. Stop affected work if scope or ownership is revoked.

## Priority and parallelism

Choose among eligible, unclaimed tasks in this order:

1. P0 before P1 before P2.
2. Within the same priority, oldest task creation timestamp first (issue
   creation for issues, draft creation for drafts).
3. If timestamps tie, compare issue numbers when both are issues; otherwise
   use the numeric Project item ID as a stable tie-breaker.

Use this same order whenever a slot becomes available.
Active work is not restarted or interrupted when a higher priority arrives.
Blocked or already active tasks do not prevent other eligible tasks from
being selected. Do not start lower priority work while an eligible higher
priority task can use that execution slot.

After each completion or handoff, re-read the eligible Ready queue and
continue until no eligible work remains. If workers or reviewers are still
active, wait using native agent tools, collect their results and reassess
the queue before ending the session.

Parallel source edits require separate task branches/worktrees when Git
is available. Reconcile shared-file ownership before concurrent editing.
Do not merge first and resolve predictable ownership conflicts later.

## Execution and review by size

Every executor posts a Plan comment in the task's issue thread before implementation,
including XS work. Read the title, existing description, linked context and
repository behavior to establish the intended outcome. If requirements or
acceptance criteria are absent or incomplete, generate concrete, testable ones
using that context. State reasonable assumptions and proceed without asking
the user to supply missing prose. Ask only when a material ambiguity cannot
be resolved from context; continue independent work while awaiting clarification.
Preserve existing requirements and human-authored content. Put clearly labeled
Requirements, Acceptance criteria and Implementation plan sections in the comment. The plan includes ordered steps, file ownership, dependencies,
validation and known uncertainty. Checklists in plan comments are allowed
as implementation steps within the single GitHub task, not a separate ledger.

- XS: the main agent plans, implements, validates and self-reviews directly.
- S and larger: create a NEW dedicated native worker for that task.
  After its handoff, assign a different native reviewer.
- M and larger: the dedicated worker writes a suitably detailed plan in the
  same task's Plan comment, then implements that task in ordered steps.
  Do not create subissues or require parent/child scheduling or reviews.

Use .agents/WORKER.md for workers and .agents/REVIEWER.md for reviewers.
Give each the exact issue URL or draft Project/item reference, operator login,
requirements, owned files, dependencies, expected output and validation commands.
Resume that worker only for the SAME task's fixes or integration.
Never reuse it for a different task, even sequentially.

A worker never reviews its own task.
The main agent's XS self-review is explicitly self-review.
Do not call it independent review or use it to waive another task's review.

## Completion and communication

For each task, retain requirements, acceptance criteria, plan, implementation/commit
or PR reference, validation outcome and review verdict in its issue comment thread.
For drafts, use only the verified associated issue thread described above.
State failures, uncertainty and remaining gates plainly.

For XS, main records its self-review before Done.
For non-XS, move to In review and obtain a current PASS from its distinct
reviewer before integration/completion.
Changes that invalidate a review require fresh review of the new candidate.
Unchanged evidence may be reused with its exact reference and limits.

Main integrates accepted work serially, resolves integration failures
and verifies the task acceptance criteria before marking Done. Close completed
issues; completed drafts remain drafts with Project status Done. All required
steps in the current Plan comment must be complete before completion.
Do not fabricate human approval, deployment, test results or delivery.
Preserve any separately required human or release gate.

Report completed tasks, active work, actual blockers and the next action.
Keep checks proportionate; repeat passing suites only for changed code,
a failure, an unresolved concern or a necessary integration check.


## GitHub MCP setup and verified access (2026-10-17)

### Connections and authentication

This workspace uses two official GitHub-hosted MCP servers in the user's
Codex configuration, separate from the built-in GitHub app connector:

| Server | Endpoint | Token environment variable |
| --- | --- | --- |
| github-projects | https://api.githubcopilot.com/mcp/x/projects | GITHUB_PAT_TOKEN |
| github-issues | https://api.githubcopilot.com/mcp/x/issues | GITHUB_PAT_TOKEN |

Install/configure with:

```powershell
codex mcp add github-projects --url https://api.githubcopilot.com/mcp/x/projects --bearer-token-env-var GITHUB_PAT_TOKEN
codex mcp add github-issues --url https://api.githubcopilot.com/mcp/x/issues --bearer-token-env-var GITHUB_PAT_TOKEN
codex mcp get github-projects
codex mcp get github-issues
```

Supply GITHUB_PAT_TOKEN through the local user/process environment; never put
its value in this repository, command output, issue bodies, or chat. Restart
Codex after changing its environment or adding servers if tools have not loaded.
A configured server alone does not prove authentication or write access. Inspect
the current tool catalog and test the exact operation before claiming success.
Automatic OAuth registration failed in this setup with "Dynamic client
registration not supported"; the configured connection uses a PAT instead.

Required GitHub access: the token's user must have write access to the repository
and edit access to the Project. Token scopes cannot exceed the user's access.
For a classic PAT, use project for Project writes (read:project is read-only),
and public_repo for issue writes in this public repository; private repositories
require repo instead. There is no separate classic Issues scope.
For a fine-grained PAT used for repository issues, select the repository and
Issues: Read and write. Contents: Read and write is needed for HTTPS code pushes,
not issue editing; Pull requests: Read and write is needed for PR writes.
Do not assume fine-grained tokens support this user-owned Project: GitHub's
current documentation lists user-owned Projects as a fine-grained token limitation.
Use an appropriate classic token or another supported authentication mechanism
for that case. Organization token policy/approval and SSO may also apply.
The actual token's complete granted scopes were not inspected or recorded.

The built-in GitHub app connector uses separate authentication. Its issue
comment/body writes returned 403 "Resource not accessible by integration" here,
even while official Issues MCP comments and Projects MCP writes succeeded.
Prefer mcp__github_issues__issue_read, issue_write, add_issue_comment and
update_issue_comment for issues; use mcp__github_projects__projects_get,
projects_list and projects_write for board operations. Do not keep retrying
an app permission failure after changing an unrelated PAT. An installed GitHub
app can only receive permissions its developer requests, not arbitrary new scopes.

### Verification results and limits

- Authenticated built-in GitHub current-user lookup returned stanjan; repository
  lookup for stanjan/warsaw-ai succeeded. Recheck identity at session start.
- Issues MCP: issue and comment reads and search succeeded; creating execution
  and stop comments on issue #1 succeeded as stanjan. This proves comment writes.
- Issue create/update calls opened interactive confirmation forms rather than
  executing immediately. The temporary test issue was NOT confirmed created,
  and the same-title edit of #1 was NOT confirmed applied. Treat these as pending
  user interaction, not permission failures or successful writes. Do not repeat
  pending submissions or bypass them through another route. Reconcile after the
  user submits/cancels; do not claim full issue create/body-edit/close validation.
- Projects MCP: Project/field/item reads succeeded; issue #1 status writes to
  In progress and back to Ready succeeded. Google Maps execution was stopped at
  the user's request before implementation; its admission was released by a
  stop comment and its Project status restored to Ready.
- Existing draft "Integrate map" (Project item 274522060) can be read with
  projects_get/get_project_item, including its Assignees and Status fields.
  A same-value Ready Status write succeeded and a separate read-back confirmed
  Ready persisted. This verifies draft Project-field writes only. Re-fetch current
  values; these IDs are historical
  test references, not reusable discovery defaults.
- The current Projects MCP schema exposes no draft create or draft title/body
  edit method. Its add_project_item accepts existing issues/PRs only, and
  updated_field edits Project fields, not a draft description. The body argument
  belongs to status-update operations; do not guess that it edits draft content.
  Draft description creation/editing, draft assignment changes and the complete
  draft task lifecycle are NOT verified/supported by the exposed tools.
- Drafts have no comments. Execute only when an explicitly associated repository
  issue provides the comment thread, or after a user-authorized move to an issue.
  Otherwise report the missing comment thread and keep affected execution blocked.
  Draft description editing is not needed or permitted by this workflow.
- Git SSH push to origin/main succeeded earlier for commit 889ab33. SSH keys,
  PAT permissions and GitHub app permissions are independent. Do not infer PAT
  code-write access or PR/merge access from an SSH push. PR creation, merge,
  labels, issue close, and other untested writes remain unverified.

For future verification, preserve existing records, use no-op/reversible probes,
read back writes, and clean up any explicitly authorized test records. Honor
interactive forms and report pending user action clearly. Never claim GitHub
access "fully works" from tool availability or one successful write.

Sources (recheck current documentation when changing setup):
- https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md
- https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-codex.md
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api

Workflow update: all agent-generated descriptions and plans use issue comments.
Issue body-edit confirmation is therefore not a prerequisite for execution.
Do not probe issue/draft body edits during normal task admission.
