# Fund Assistant — Agent Rules

> Project-level skill. All AI agents working on this project MUST follow these rules before completing any task.

## Rule 1: Verify Build Before Completion

**Before marking any task as done or presenting the result to the user, you MUST ensure the project compiles cleanly:**

```bash
NODE_OPTIONS="" npx tsc --noEmit     # TypeScript check (zero errors)
NODE_OPTIONS="" npx vite build        # Production build (exit code 0)
```

- If there are TypeScript errors, fix them first.
- If the build fails, fix the issue before proceeding.
- Do NOT ask the user "do you want me to fix this?" — just fix it.

## Rule 2: Sync Documentation After Completion

**After finishing a task and verifying the build, update the following files if the changes warrant it:**

- **`README.md`** — New features, changed behavior, updated setup steps
- **`PLAN.md`** — Mark completed phases, update status table, add new items
- **Task list** — Mark tasks as completed/in-progress with `TaskUpdate`

If nothing has changed that affects docs (e.g., a minor one-line bugfix), you may skip this.

## Rule 3: Verify & Ask Before Commit

**Before committing to GitHub, you MUST:**

1. Tell the user **what changed** (brief summary of files and purpose)
2. Tell the user **how to verify** the change works (concrete steps)
3. **Wait for explicit user confirmation** before running `git add`, `git commit`, or `git push`

Never auto-commit or auto-push without user approval.

## When All Three Rules Apply

At the end of each substantive work session:

```
1. tsc --noEmit + vite build      ← verify compile
2. Update README/PLAN if needed   ← sync docs
3. Show diff + verify steps       ← ask before commit
```
