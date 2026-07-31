---
name: frontend-quality-workflow
version: 1.1.0
description: |
  Frontend development workflow that guarantees code quality when implementing from a plan/spec document.
  Orchestrates: grill-me (requirement grilling) -> planning-with-files (plan tracking)
  -> task-implement (autonomous execution + independent verification) -> impeccable (production-grade UI)
  -> code-simplifier (refactor / cleanup) -> setup-pre-commit (commit-time quality gate).
  Use when: building frontend features from a plan or spec, "按 plan 文档实现前端", "确保 AI 生成前端的代码质量",
  setting up a quality-gated frontend pipeline, or any React/TS/Vite frontend task where correctness AND craft matter.
---

# Frontend Quality Workflow

A deterministic pipeline for AI-assisted frontend development that keeps the code quality high while
executing against a written plan. Each phase maps to one installed skill. Run phases in order; do not
skip the cleanup/verification phases.

## Phase 0 — Preconditions

- Project must be a JS/TS frontend repo with `package.json` (React + TS + Vite per user preference).
- Skills required (all installed at `~/.workbuddy/skills/`): `grill-me`, `planning-with-files`, `task-implement`,
  `impeccable`, `code-simplifier`, `setup-pre-commit`.

## Phase 1 — Plan (grill-me → planning-with-files)

- **Step 1 — Requirement grilling (grill-me)**: Before writing any plan file, invoke `grill-me` to
  stress-test the user's requirements / initial design. Walk each top-level decision branch, surface hidden
  assumptions, and resolve trade-offs one question at a time until there are no open "it depends" answers.
  This produces a shared understanding that the written plan is built on — directly improving plan quality.
  - When to run: always when the request is conceptual / ambiguous / has open design questions. Skip only when
    the user hands over a fully specified spec with every decision already made.
  - grill-me is conversational: for each question give your recommendation first, ask, then wait for the answer.
- **Step 2 — Capture plan (planning-with-files)**: Invoke `planning-with-files` to create `task_plan.md`,
  `findings.md`, `progress.md`, now grounded in the grilled decisions.
- Break the feature into <= a few phases, each with checkable outcomes. This becomes the source of truth
  the executor follows. Keep plan verbose enough that execution needs no human in the loop.

## Phase 2 — Execute (task-implement)

- Invoke `task-implement` with the plan directory/goal. It reads the plan, decomposes work, may delegate
  to subagents, and runs **independent verification** before declaring done.
- It acts as the user's proxy: make judgment calls, re-read the plan when ambiguous, pause only for
  genuine blockers. Crucially it verifies results itself before handing back.

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
- This is the phase that directly answers "ensure code quality".

## Phase 5 — Gate (setup-pre-commit)

- Invoke `setup-pre-commit` to install Husky + lint-staged (Prettier) + typecheck + tests as a
  commit-time gate. Now every future commit is auto-formatted and type-checked.
- Run the test/typecheck command yourself to confirm the gate is green before reporting completion.

## Hard rules

- Never mark a phase done without its verification step (task-implement's self-check, typecheck/tests).
- Do not push to remote without explicit user permission.
- After finishing, update `progress.md` and the workspace memory log.

## Trigger phrases that should auto-invoke this skill

"按plan实现前端", "确保代码质量", "前端开发工作流", "quality-gated frontend", "从计划文档落地前端功能".

## Changelog

- **2026-07-31 v1.1.0** — Phase 1 引入 `grill-me` 作为需求打磨步骤（Step 1 需求追问 → Step 2 planning-with-files 落盘），提升 plan 质量；补充 `version` 字段与 Changelog。自本版本起该技能同步纳入 `fund-assistant` 仓库（`.workbuddy/skills/`）做版本跟踪。
- **1.0.0** — 初始版本：五阶段流水线 grill-me→planning-with-files→task-implement→impeccable→code-simplifier→setup-pre-commit。
