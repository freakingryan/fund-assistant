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

---

## Rule 4: Responsive & Theming Compliance

**When designing or modifying UI components, ALL of the following MUST be ensured:**

### 4.1 Device Adaptation (Responsive)
- **Screen sizes**: Components must work on mobile (< 640px), tablet (640-1024px), desktop (> 1024px) and foldable/ultrawide screens. Use responsive utilities (`sm:`, `md:`, `lg:`, container queries) rather than fixed widths.
- **Input methods**: Both mouse/trackpad (hover, click) AND touch (tap, long-press) must work. Use `onClick` + `onTouchEnd` for interactive elements. Set `touch-action: manipulation` to prevent zoom delay.
- **Touch targets**: Interactive elements must have a minimum hit area of 44×44px on mobile.
- **Note**: You don't need to test on actual devices. Follow these implementation guidelines in the code.

### 4.2 Dark / Light Mode
- All text colors MUST use Tailwind theme tokens (`text-foreground`, `text-muted-foreground`) or explicit dark variants (`dark:text-foreground`). Never hardcode a color that would be invisible in either mode (e.g., `text-black` or `text-white`).
- Background colors MUST use theme tokens (`bg-background`, `bg-card`, `bg-muted`) or explicit dark variants (`dark:bg-card`).
- Border colors MUST use `border` or `stroke-border` with dark variants.
- SVG elements (stroke, fill) MUST include `dark:` variants when using semantic colors (e.g., `stroke-red-500 dark:stroke-red-400`).
- Overlay/popover/tooltip backgrounds MUST use `bg-background` or `bg-card` (not hardcoded `bg-white`) to work in dark mode.

### 4.3 Verification
- After making UI changes, visually inspect the component in both light and dark mode.
- If the project supports a theme toggle, use it to switch modes and check contrast/readability.
- Ensure no hardcoded light-mode-only colors exist in the modified files.
