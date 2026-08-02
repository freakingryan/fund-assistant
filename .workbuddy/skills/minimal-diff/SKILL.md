---
name: minimal-diff
description: >
  Generate the smallest correct change that solves the stated problem.
  No drive-by formatting, no opportunistic renames, no "while I'm here"
  expansions. Implements the Surgical-Before-Sweeping gate of Aparigraha
  with diff-size guardrails, scope checks, and reversibility validation.
license: Apache-2.0
compatibility: Designed for Claude Code and compatible AI agent environments
domain: engineering
status: published
tags: [category, build, pragmatism, advisory]
keywords:
  [
    surgical change,
    no drive-by,
    diff size,
    scope statement,
    git revert,
    reversibility,
    commit splitting,
    surgical-before-sweeping,
    blast radius,
    forbidden zones,
  ]
metadata:
  version: "1.0.0"
  dependencies: "constitution, scratchpad, pragmatism, auditor, style-conformance"
  reasoning_mode: plan-execute
  skill_type: standard
---

# Minimal Diff

> _"The smallest correct change that survives review and production
> wins. Everything else is a separate ticket."_

## Context

Invoked whenever the agent is about to produce a code change. The skill
implements the **Surgical-Before-Sweeping** gate of Aparigraha: keep the
diff focused on the user's stated requirement, surface out-of-scope
improvements as suggestions, and validate that the resulting change
remains reversible in a single `git revert` step.

A minimal diff is not the _shortest_ diff — it is the _smallest correct_
one. Splitting a tangled change into focused commits (or pulling guards
into the call site instead of mutating the callee) is often what
"minimal" looks like. The goal is reviewer cognitive load, not raw line
count.

## Scope

**In scope:**

- Defining the **scope statement** for the current task (what counts as
  in-scope, what does not).
- Computing diff metrics (files touched, hunks, +/- lines, blast radius).
- Enforcing the no-drive-by rule on the agent's own output.
- Validating reversibility: the diff `git revert`s cleanly with no
  cascading failures.
- Splitting a multi-purpose diff into focused commits.
- Surfacing out-of-scope changes the agent noticed but did not apply.

**Out of scope:**

- Style/formatting decisions — owned by `style-conformance`.
- Reuse decisions about helpers — owned by `reuse-first`.
- Plan-vs-diff alignment after the fact — owned by `auditor`.
- Refactoring patterns — owned by `refactoring`.
- Test authoring strategy — owned by `unit-testing` / `tdd-workflow`.

---

## Micro-Skills

### 1. Scope Statement ⚡ (Power Mode)

**Goal:** Make explicit what is in-scope before any code is written.

**Steps:**

1. Restate the user's task in one sentence: "Add X / fix Y / change Z."
2. Define the **diff envelope**:
   - Required files / modules / public surfaces.
   - Required test changes (added or updated, by name).
   - Forbidden zones (do not touch unless required: configuration files,
     migrations, public APIs, generated code, vendor folders).
3. Identify the **acceptance signal**: how do we know the change is
   correct? (A failing test now passing; a reproduction case no longer
   reproducing; a benchmark within target.)
4. Persist the scope statement at the top of the audit log; downstream
   skills read it.

**Scope statement template:**

```yaml
intent: "Fix the off-by-one in pagination when total < page_size."
in_scope:
  files: [src/pagination/Paginator.ts, tests/pagination/Paginator.test.ts]
  modules: ["pagination"]
  surfaces: []
out_of_scope:
  - "Naming improvements in Paginator.ts"
  - "Refactoring Paginator into smaller classes"
  - "Logging additions"
acceptance:
  - "tests/pagination/Paginator.test.ts:'last page returns correct count' passes"
  - "Manual repro with total=3, page_size=10 returns 3 items, not 0"
forbidden:
  - "Public API of Paginator class"
  - "Database migrations"
  - "package.json (no new deps for this fix)"
```

### 2. Diff Sizing & Heuristics 🌿 (Eco Mode)

**Goal:** Keep diff size proportional to the task; flag oversize diffs
early.

**Heuristic budgets** (defaults, override per task):

| Task type                       | Soft cap (warn)     | Hard cap (escalate)     |
| ------------------------------- | ------------------- | ----------------------- |
| Bug fix (no behaviour change)   | 50 lines, 3 files   | 150 lines, 6 files      |
| Bug fix (with behaviour change) | 100 lines, 4 files  | 250 lines, 8 files      |
| Small feature                   | 200 lines, 6 files  | 500 lines, 12 files     |
| Refactor (no behaviour change)  | 400 lines, 10 files | 800 lines, 20 files     |
| Migration / mechanical sweep    | unbounded by lines  | escalate above 30 files |

**Steps:**

1. Estimate expected diff size from the scope statement.
2. As the agent works, monitor running diff metrics (`+lines`, `-lines`,
   files, hunks). When a soft cap is crossed, pause and ask:
   "We're at `[N]` lines / `[M]` files for a `[task type]`. Continue,
   split into commits, or narrow the scope?"
3. When a hard cap is crossed, mandatory escalation: do not auto-proceed.

### 3. No Drive-By Rule ⚡ (Power Mode)

**Goal:** Stop the agent's natural urge to "fix this while I'm here".

**Drive-by patterns to detect and block in the agent's own output:**

- Reformatting lines outside the change hunks.
- Renaming variables, methods, or types outside the change scope.
- Adding/removing comments outside the change scope.
- "Tightening" types (`any` → specific) outside the change scope.
- Sorting imports across the file.
- Changing indentation/quotes/semicolons across the file.
- Touching test files unrelated to the requirement to "improve" them.
- Adding logging to "help debugging" outside the change scope.
- Updating deprecated API usage outside the change scope.

**Steps:**

1. After producing the draft diff, scan it against the patterns above.
2. For each drive-by hit:
   - Revert that piece of the diff.
   - Add the observation to `deviations.suggested` for the post-task
     summary.
3. If the drive-by is _required_ for correctness (e.g., a rename whose
   omission breaks the build), keep it but note in the audit log
   why scope had to widen.

### 4. Reversibility Check 🌿 (Eco Mode)

**Goal:** Confirm the change can be reverted in one step without
collateral damage.

**Steps:**

1. Mentally run `git revert <this-commit>`.
2. Confirm the revert would not require additional follow-ups in the
   same change: schema rollback, cache flush, feature-flag toggle,
   migration reversal.
3. If the change introduces an irreversible side effect (DB migration,
   data write, external system call), require:
   - An explicit rollback plan in the audit log.
   - Confirmation from the user (Pragya direction checkpoint) before
     committing.
4. Prefer **expand-and-contract** patterns when the change is
   irreversible-by-nature (additive then later subtractive) so each
   step remains reversible on its own. (For larger system rewrites, the
   same shape is the **Strangler Fig** pattern — see
   [legacy-upgrade](../../90-maintenance/legacy-upgrade/SKILL.md).)

### 5. Commit Splitting ⚡ (Power Mode)

**Goal:** When a diff necessarily covers more than one purpose, split
into focused commits before merging.

**Triggers:**

- Diff covers two or more distinct concerns (e.g., a bug fix + a small
  refactor needed to make the fix clean).
- Diff contains test additions that could land independently of the fix
  to capture the bug first.
- Diff includes a rename that is mechanically separable from a logic
  change.

**Steps:**

1. Group hunks by purpose using a small label set: `fix`, `test`,
   `rename`, `refactor`, `format`, `docs`.
2. Stage and commit per purpose, in dependency order.
3. Each commit must build and pass its own scope of tests.
4. Each commit message follows the repo's existing style; check
   `git log --oneline -10` for the convention.

### 6. Out-of-Scope Surfacing 🌿 (Eco Mode)

**Goal:** Note observed improvements outside the diff so they aren't
forgotten — without smuggling them in.

**Steps:**

1. As the agent reads code in service of the task, log any out-of-scope
   improvements to `deviations.suggested` (typed, no auto-fix).
2. On task completion, present a clearly labelled "Follow-up
   suggestions (NOT in this diff)" block to the user.
3. Optionally write the suggestions to `docs/style-followups.md` or
   open a tracking issue if the user opts in. Never silently commit.

### 7. Auditor Hand-off 🌿 (Eco Mode)

**Goal:** Hand the final diff and scope statement to `auditor` for
plan-vs-diff alignment.

**Steps:**

1. Pass `{scope_statement, diff_metrics, drive_by_reverts,
deviations_suggested}` to `auditor`.
2. If `auditor` flags drift between scope and diff, treat it as a
   blocking signal and reduce the diff before committing.

---

## Inputs

| Parameter         | Type       | Required | Description                                                             |
| ----------------- | ---------- | -------- | ----------------------------------------------------------------------- |
| `task_intent`     | `string`   | yes      | One-sentence restatement of what the task must achieve.                 |
| `target_files`    | `string[]` | no       | Files the agent expects to touch (will be validated against scope).     |
| `task_type`       | `enum`     | no       | `bug-fix` \| `feature` \| `refactor` \| `migration`. Default: inferred. |
| `caps`            | `object`   | no       | Override of soft/hard caps for this task.                               |
| `forbidden_zones` | `string[]` | no       | Glob patterns the diff must not touch unless explicitly approved.       |

## Outputs

| Field                  | Type       | Description                                                |
| ---------------------- | ---------- | ---------------------------------------------------------- |
| `scope_statement`      | `object`   | The structured scope record (in/out/forbidden/acceptance). |
| `diff_metrics`         | `object`   | `{files, hunks, plus, minus}` for the produced diff.       |
| `drive_by_reverts`     | `object[]` | Drive-by edits the skill removed before committing.        |
| `deviations_suggested` | `object[]` | Out-of-scope improvements observed but not applied.        |
| `commit_plan`          | `object[]` | If split, the ordered list of commits with messages.       |
| `reversibility`        | `object`   | `{revertable, irreversible_steps, rollback_plan}`          |

---

## Guardrails

- **Scope statement comes first.** No code is written until the scope
  statement exists.
- **Soft cap → ask. Hard cap → stop.** The agent never silently produces
  an oversize diff.
- **No drive-by edits, ever.** If the agent catches itself reformatting
  or renaming outside scope, it reverts that part.
- **Reversibility is required.** A clean `git revert` must be possible.
  If not, an explicit rollback plan must be recorded and the user must
  confirm before commit.
- **No mixing concerns in one commit.** When the diff covers more than
  one purpose, split.
- **Forbidden zones are forbidden.** Touching configuration, migrations,
  generated code, public APIs, or vendored code without explicit
  approval is a constitutional violation.
- **Minimal does not mean broken.** The smallest _correct_ change wins —
  do not under-fix to keep the diff small. Add the necessary tests and
  guards.

## Ask-When-Ambiguous

**Triggers:**

- Soft cap on diff size has been crossed.
- The user's task naturally requires touching a forbidden zone.
- A required correctness change is mechanically inseparable from a
  larger refactor.
- The change has an irreversible side effect (DB migration, external
  call, cache poisoning).
- The agent has identified a high-leverage out-of-scope improvement
  that the user might want included.

**Question Templates:**

- "We're at `[N]` lines / `[M]` files for a `[task type]`. Continue,
  split into commits, or narrow the scope?"
- "This fix requires changing `[forbidden file]`. Approve the scope
  expansion, or scope the fix differently?"
- "This change is irreversible (DB migration). Rollback plan: `[plan]`.
  Approve to proceed?"
- "I noticed `[improvement]` outside the change scope. Want me to
  (A) ignore, (B) record as a follow-up, or (C) include in a separate
  commit in this PR?"
- "Bug fix and the refactor needed to make the fix clean are tangled.
  Want them as (A) one commit, (B) refactor first then fix, or
  (C) fix first then refactor?"

## Decision Criteria

| Situation                                               | Action                                                  |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Diff strictly inside scope, all caps green              | Proceed.                                                |
| Soft cap crossed                                        | Ask the user; default to splitting commits.             |
| Hard cap crossed                                        | Stop; require user direction (Pragya).                  |
| Drive-by edit detected in the agent's own draft         | Revert it; log as deviation suggestion.                 |
| Forbidden zone touched, not explicitly approved         | Revert that part; ask the user.                         |
| Diff is irreversible without a plan                     | Stop; require explicit rollback plan and user approval. |
| Multiple concerns tangled in one diff                   | Split into focused commits.                             |
| Test changes can land before the fix to capture the bug | Land tests first, then fix, in two commits.             |

## Success Criteria

- Every diff has an associated scope statement and acceptance signal.
- No drive-by edits are present in the merged diff.
- Diff metrics are within the appropriate caps for the task type.
- The change `git revert`s cleanly OR has an explicit rollback plan
  approved by the user.
- Out-of-scope improvements are recorded as suggestions, never smuggled.
- When concerns are mixed, commits are split before merge.

## Failure Modes

- **The "while I'm here" sprawl.** Agent fixes formatting / renames /
  adds comments outside the requested scope.
  **Recovery:** Reset the diff to scope-only; surface the extras as a
  separate suggestion list. If already merged, file follow-up tickets
  rather than amending.

- **Under-fix to stay small.** Agent ships a fix that papers over the
  bug instead of correcting it.
  **Recovery:** Re-open. The smallest _correct_ change wins; correctness
  is not negotiable. Widen scope and re-run the gates if needed.

- **Tangled commits.** A bug fix and a mechanical rename ship as one
  commit, making the rename ungrep-able.
  **Recovery:** Split next time. If already merged, document the entanglement
  and the recommended way to read the commit.

- **Hidden side effects.** The change writes to a database / cache /
  external service in a way `git revert` won't undo.
  **Recovery:** Switch to expand-and-contract: do the additive change
  first (reversible), do the destructive change in a follow-up that has
  its own rollback plan.

- **Forbidden-zone creep.** Agent touches `package.json` / migrations /
  public API to make the fix work, without explicit approval.
  **Recovery:** Revert those parts. Ask the user. The forbidden zones
  exist precisely to force this conversation.

## Audit Log

```
[scope-stated]              intent="{summary}" in_files={list} out_of_scope={list} forbidden={list}
[diff-sized]                files={N} hunks={M} plus={P} minus={Q} task_type={t} cap={soft|hard|green}
[drive-by-reverted]         file="{path}" pattern="{name}" lines_reverted={N}
[reversibility-confirmed]   revertable={true|false} irreversible_steps={list} rollback_plan="{summary}"
[forbidden-zone-touched]    file="{path}" approved_by={user|self_with_reason}
[commits-split]             count={N} purposes={list}
[deviations-surfaced]       count={N} report_path="{path|inline}"
[auditor-handed-off]        scope_drift={none|flagged} action_taken="{summary}"
```

---

## Examples

### Example 1 — Bug fix stays surgical

**Scenario:** Off-by-one in pagination when `total < page_size`.

```text
[scope-stated]
  intent: "Fix off-by-one in Paginator when total < page_size"
  in_scope: [src/pagination/Paginator.ts, tests/pagination/Paginator.test.ts]
  forbidden: [package.json, public API of Paginator]
  acceptance: "test 'last page returns correct count' passes"

draft diff:
  src/pagination/Paginator.ts: 3 lines changed (the bug)
  src/pagination/Paginator.ts: 11 lines changed (variable rename, "while I'm here")
  tests/pagination/Paginator.test.ts: 14 lines added (new test cases)

[drive-by-reverted] file=Paginator.ts pattern=rename-variable lines_reverted=11
                    note: "logged in deviations.suggested for follow-up"

final diff:
  src/pagination/Paginator.ts: 3 lines changed
  tests/pagination/Paginator.test.ts: 14 lines added

[diff-sized] files=2 hunks=2 plus=14 minus=3 cap=green
[reversibility-confirmed] revertable=true
```

### Example 2 — Tangled change → split commits

**Scenario:** Adding a feature requires extracting a method first.

```text
[scope-stated] intent: "Add export-as-CSV button to InvoiceList"

initial draft = 220 lines:
  - extract method `formatInvoiceForExport` from InvoiceRow
  - add CSV export utility
  - add button + wire-up

[diff-sized] files=4 hunks=7 plus=190 minus=30 cap=soft-warn

[commits-split] count=3 purposes=[refactor, feat, test]
  commit 1: "refactor(invoices): extract formatInvoiceForExport"  (35 lines, tests untouched)
  commit 2: "feat(invoices): add CSV export utility"              (90 lines, with new tests)
  commit 3: "feat(invoices): add export-as-CSV button"            (45 lines, wires up the utility)

each commit:
  - builds independently
  - passes its own scope of tests
  - revertable on its own
```

### Example 3 — Irreversible side effect → expand-and-contract

**Scenario:** Renaming a column in a heavily-read table.

```text
[scope-stated] intent: "Rename users.legacy_email → users.email_legacy"

[reversibility-confirmed] revertable=false
  irreversible_steps:
    - SQL ALTER TABLE rename
  rollback_plan:
    - keep both column names; switch over in three steps:
      1. add email_legacy as a new column, copy values (additive, reversible)
      2. update readers to prefer email_legacy, fall back to legacy_email
      3. (separate ticket, after a soak period) drop legacy_email

[ask-when-ambiguous] "Step 3 is irreversible after the soak. Approve plan?"
```

---

## Edge Cases

- **The user explicitly says "do everything in one commit."** Honour the
  override (Pragya), record it as a documented exception, but still run
  drive-by detection and reversibility validation.

- **The user says "don't worry about caps, just make it work."** Honour
  it, but emit the diff metrics anyway so the user has the data.

- **Mechanical sweeps** (e.g., codemod renaming an API across 80 files).
  Override caps with `task_type=migration`. Use a single, mechanical,
  greppable diff. Document the codemod used.

- **The fix requires touching a forbidden zone** and the user has
  approved. Note in the audit log that the scope expansion was approved.
  Do not generalise the approval — the next task starts with the same
  forbidden zones.

- **A "minimal" fix would conflict with `style-conformance`.** Honour
  conformance for new code; if the conflict means the minimal fix would
  introduce a non-conforming pattern, surface it and ask before merging.

- **A test failure outside the scope appears mid-task.** Do not silently
  fix it. Either: (A) it is a regression caused by this change — in
  which case the change is incomplete and the fix is in scope; or
  (B) it is an unrelated flake/break — in which case it is a new task.
  Surface the distinction to the user.

- **The agent spots an obvious correctness/security issue outside the
  diff.** Aparigraha defers to Ahimsa here: surface the issue
  immediately via `pragya`. Out-of-scope rules apply to _style and
  cleanliness_, not to correctness or security failures.
