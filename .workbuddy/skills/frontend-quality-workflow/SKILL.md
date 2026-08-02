---
name: frontend-quality-workflow
version: 1.2.0
description: |
  Frontend development workflow that guarantees code quality when implementing from a plan/spec document.
  Orchestrates: grill-me (requirement grilling) -> planning-with-files (plan tracking, + research for
  external facts) -> prototype (throwaway UI/logic validation) -> task-implement (autonomous execution
  with minimal-diff discipline) -> impeccable (production-grade UI) -> code-simplifier (cleanup)
  -> code-review (two-axis diff review) -> setup-pre-commit (commit-time quality gate).
  Use when: building frontend features from a plan or spec, "按 plan 文档实现前端", "确保 AI 生成前端的代码质量",
  setting up a quality-gated frontend pipeline, or any React/TS/Vite frontend task where correctness AND craft matter.
---

# Frontend Quality Workflow

A deterministic pipeline for AI-assisted frontend development that keeps the code quality high while
executing against a written plan. Each phase maps to one installed skill. Run phases in order; do not
skip the cleanup/verification phases.

## Phase 0 — Preconditions

- Project must be a JS/TS frontend repo with `package.json` (React + TS + Vite per user preference).
- Skills required (all installed at `~/.workbuddy/skills/`): `grill-me`, `planning-with-files`, `research`,
  `prototype`, `task-implement`, `impeccable`, `code-simplifier`, `code-review`, `setup-pre-commit`, `handoff`.
  - `minimal-diff` is applied as an execution discipline inside Phase 2 (not a separate phase).

## Phase 1 — Plan (grill-me → planning-with-files [+ research])

- **Step 1 — Requirement grilling (grill-me)**: Before writing any plan file, invoke `grill-me` to
  stress-test the user's requirements / initial design. Walk each top-level decision branch, surface hidden
  assumptions, and resolve trade-offs one question at a time until there are no open "it depends" answers.
  This produces a shared understanding that the written plan is built on — directly improving plan quality.
  - When to run: always when the request is conceptual / ambiguous / has open design questions. Skip only when
    the user hands over a fully specified spec with every decision already made.
  - grill-me is conversational: for each question give your recommendation first, ask, then wait for the answer.
- **Step 2 — Capture plan (planning-with-files)**: Invoke `planning-with-files` to create `task_plan.md`,
  `findings.md`, `progress.md`, now grounded in the grilled decisions.
- **Step 3 (optional) — External facts (research)**: When the feature needs external facts / best-practices /
  API contracts, invoke `research` to spin up a **background agent** that investigates primary sources
  (official docs, source, specs, first-party APIs) and writes findings into the repo (default `findings.md`,
  matching the repo's existing convention). This is NOT a substitute for grill-me — grill-me aligns with the
  _user's_ requirements; research gathers _external_ truth. Skip when the plan is self-contained.
- Break the feature into <= a few phases, each with checkable outcomes. This becomes the source of truth
  the executor follows. Keep plan verbose enough that execution needs no human in the loop.

## Phase 1.5 — Prototype (prototype) [OPTIONAL · de-risk before building]

- Invoke `prototype` to answer a design question with **throwaway code** _before_ writing production code.
- Pick the branch from the question:
  - **"Does this logic / state model feel right?"** → logic prototype (tiny interactive app pushing the
    state machine through hard cases).
  - **"What should this look like?"** → UI prototype (several **radically different** UI variations on a
    single route, switchable via URL search param + floating bottom bar).
- Rules (from the skill): clearly marked throwaway; obey the project's existing routing convention
  (our React Router — do NOT invent a new top-level structure); one command to run; no persistence by
  default; skip polish; surface state after each action. When done, fold the validated decision into the
  real code and capture the prototype as a throwaway branch out of `main`, leaving a pointer on the issue.
- Skip when the feature is small / low-UI-risk / already specced visually.

## Phase 2 — Execute (task-implement) [+ minimal-diff discipline]

- Invoke `task-implement` with the plan directory/goal. It reads the plan, decomposes work, may delegate
  to subagents, and runs **independent verification** before declaring done.
- It acts as the user's proxy: make judgment calls, re-read the plan when ambiguous, pause only for
  genuine blockers. Crucially it verifies results itself before handing back.
- **Apply the `minimal-diff` discipline as the execution contract** (from dhruvinrsoni/agentskills-garden):
  - Write a **scope statement** before any code (intent / in-scope / out-of-scope / forbidden zones / acceptance).
  - Enforce **no-drive-by**: no incidental reformatting, renames, comment or import tidy-ups outside the change.
  - Respect diff-size caps; if a soft cap is crossed, pause and ask (continue / split / narrow).
  - Ensure the change `git revert`s cleanly (document a rollback plan for irreversible side effects).
  - **Split** multi-purpose diffs into focused commits (fix / test / rename / refactor / format / docs).
  - Surface out-of-scope improvements as suggestions — never smuggle them into the diff.

## Phase 3 — Craft (impeccable)

- After functional code exists, invoke `impeccable` to raise UI/UX quality: responsive layout,
  motion/micro-interactions, accessibility (a11y/WCAG), performance, typography, color, spacing.
- This prevents the "generic AI look" and aligns output with production-grade expectations.

## Phase 4 — Cleanup (code-simplifier) [CODE QUALITY GATE]

- Invoke `code-simplifier` as the mandatory quality pass. Apply its principles:
  - Single responsibility per function; target < 50 lines (ideal 10–30).
  - <= 4 params; use data/config objects beyond that.
  - Guard clauses / early returns to avoid deep nesting.
  - Remove dead code, unused imports, duplicated logic (extract only when reused >= 3x).
- This is the phase that directly answers "ensure code quality". (Its structural principles complement,
  not replace, the `code-review` Standards axis in Phase 4.5.)

## Phase 4.5 — Review (code-review) [TWO-AXIS DIFF REVIEW]

- After cleanup, invoke `code-review` to review the diff since the plan's fixed point (e.g. the branch
  base / last merge-base) along **two axes**, run as parallel sub-agents and reported side by side:
  - **Standards** — does the code follow this repo's documented coding standards (+ a Fowler code-smell
    baseline: Mysterious Name, Duplicated Code, Feature Envy, Data Clumps, Primitive Obsession, Repeated
    Switches, Shotgun Surgery, Divergent Change, Speculative Generality, Message Chains, Middle Man,
    Refused Bequest)?
  - **Spec** — does the code faithfully implement the originating spec? Use `task_plan.md` / `findings.md`
    as the spec source (the skill's issue-tracker lookup falls back to these plan files).
- Treat findings as a **blocking signal** before the Gate: reduce the diff / fix spec drift, then proceed.

## Phase 5 — Gate (setup-pre-commit)

- Invoke `setup-pre-commit` to install Husky + lint-staged (Prettier) + typecheck + tests as a
  commit-time gate. Now every future commit is auto-formatted and type-checked.
- Run the test/typecheck command yourself to confirm the gate is green before reporting completion.

## Cross-cutting — Handoff (PRIMARY context-management mechanism)

**`handoff` (mattpocock) 是会话上下文管理的首选 / 主机制。** 在会话结束或交给另一 agent / 会话时，
**优先**调用 `handoff` 技能：把对话压缩成 handoff 文档，存入 **OS 临时目录（非工作区）**，含
**"suggested skills"** 段，并**脱敏**密钥 / 密码 / PII。它生来是「瘦指针」——**引用** specs / plans /
commits / diffs 的**路径**，**绝不复制**其内容。

### 三层职责边界（消除命名撞车与内容复述）

1. **`handoff` 技能产出（主，/tmp 易失）** — 立即续接用的轻量快照：本次做了什么（commits）、下一步焦点、
   该调哪些 skill。**只引用，不复述**。
2. **`plans/<feature>/`（提交，持久）** — 活跃功能的**唯一真相源**（`task_plan` / `progress` / `findings`），
   由 planning-with-files 维护。handoff 指向它。
3. **`PENDING_PLAN.md`（提交，持久）** — 未实现功能 backlog。handoff 指向它。

- 仓库根级的 `HANDOFF-*.md`「全文复述式」交接惯例**已退役**（旧文档归档至 `archive/handoff/`，不删除）；
  不再新写总结式交接文档，避免与 `plans/` 重复。
- **持久性说明**：`handoff` 写在 /tmp，可能随系统清理丢失；因此 `plans/` + `PENDING_PLAN.md` + git log
  是持久底稿。若 /tmp 快照不在，从这三处重建上下文即可。
- 这是跨阶段实践，不是编号阶段。

## Hard rules

- Never mark a phase done without its verification step (task-implement's self-check, typecheck/tests,
  code-review's two-axis report).
- Do not push to remote without explicit user permission.
- After finishing, update `progress.md` and the workspace memory log.

## Trigger phrases that should auto-invoke this skill

"按plan实现前端", "确保代码质量", "前端开发工作流", "quality-gated frontend", "从计划文档落地前端功能".

## Changelog

- **2026-08-02 v1.2.1** — 确立 **`handoff`（mattpocock）为会话上下文管理的主机制**：Cross-cutting 段改为「PRIMARY context-management mechanism」，明确三层边界（handoff=/tmp 轻量快照主、plans/=活跃真相源、PENDING_PLAN.md=持久 backlog）；退役仓库根 `HANDOFF-*.md`「全文复述式」交接惯例（旧文档归档至 `archive/handoff/`，不删除），消除命名撞车与内容复述。handoff 因 /tmp 易失，持久底稿由 plans/+PENDING_PLAN.md+git log 承担。
- **2026-08-02 v1.2.0** — 引入 mattpocock/dhruvinrsoni 工程技能优化流水线：新增 **P1.5 Prototype**（动手前用一次性原型验证 UI/逻辑）、**P4.5 Review**（code-review 双轴 diff 评审 vs 规格+标准）；P1 增加可选的 **research** 子步骤（后台 agent 调研外部事实落 findings.md）；P2 融入 **minimal-diff** 执行纪律（scope statement / no-drive-by / commit 拆分 / 可逆性）；Cross-cutting 段补充 **handoff** 的 mattpocock 约定（临时目录 + suggested-skills + 脱敏）。无现有阶段被取代，全部为新增/融入/对齐。
- **2026-07-31 v1.1.0** — Phase 1 引入 `grill-me` 作为需求打磨步骤（Step 1 需求追问 → Step 2 planning-with-files 落盘），提升 plan 质量；补充 `version` 字段与 Changelog。
- **1.0.0** — 初始版本：五阶段流水线 grill-me→planning-with-files→task-implement→impeccable→code-simplifier→setup-pre-commit。
