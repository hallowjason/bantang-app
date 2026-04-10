---
name: ralph-wiggum
description: Implement iterative self-referential AI development loops. Use this skill when the user wants to run Claude in an autonomous loop, repeatedly working on the same task until a completion condition is met. Handles `/ralph-loop` to start a loop and `/cancel-ralph` to stop it.
---
# Ralph Wiggum Skill
This skill implements the **Ralph Wiggum technique** — a continuous self-referential AI development loop where Claude works on the same task repeatedly, improving on its previous output each iteration, until a completion condition is reached.
## Core Concept
The loop works as follows:
1. The user runs `/ralph-loop` once with a task description
2. Claude works on the task
3. When Claude tries to exit, the Stop hook intercepts and feeds the **same prompt** back
4. Claude sees its previous work in files and git history, and iteratively improves
5. The loop repeats until `--completion-promise` text is output, or `--max-iterations` is reached
## Commands
### `/ralph-loop`
Start a Ralph loop in your current session.
**Usage:**
```
/ralph-loop "<prompt>" --max-iterations <n> --completion-promise "<text>"
```
**Options:**
- `--max-iterations <n>` — Stop after N iterations (default: unlimited)
- `--completion-promise "<text>"` — Exact phrase Claude must output (inside `<promise>...</promise>` tags) to end the loop
**Example:**
```
/ralph-loop "Build a REST API for todos. Requirements: CRUD, input validation, tests passing. Output <promise>COMPLETE</promise> when done." --completion-promise "COMPLETE" --max-iterations 50
```
### `/cancel-ralph`
Cancel the active Ralph loop.
**Usage:**
```
/cancel-ralph
```
## Completion Promise Rules
- Output the promise ONLY when the task is **genuinely complete**
- Use exact XML tags: `<promise>YOUR_PHRASE</promise>`
- **Never output a false promise** to escape the loop — the loop is designed to continue until the promise is truly satisfied
## When to Use Ralph
**Good for:**
- Well-defined tasks with clear, verifiable success criteria
- Tasks requiring iteration (e.g., getting all tests to pass)
- Greenfield projects where you can walk away
- Tasks with automatic verification (tests, linters, CI)
**Not good for:**
- Tasks requiring human judgment or design decisions
- One-shot operations
- Tasks with ambiguous or unverifiable success criteria
## Monitoring the Loop
```bash
# View current iteration number
grep '^iteration:' .claude/ralph-loop.local.md
# View full state
head -10 .claude/ralph-loop.local.md
```
## Writing Good Prompts
Always include:
1. **Clear completion criteria** — what "done" looks like
2. **An escape hatch** — set `--max-iterations` to prevent infinite loops
3. **Self-correction instructions** — tell Claude to run tests, fix failures, and retry
**Example of a good prompt:**
```
Implement a user authentication module with JWT.
Steps:
1. Write failing tests
2. Implement the feature
3. Run tests; if any fail, debug and fix
4. Repeat until all tests pass
5. Output: <promise>ALL_TESTS_PASSING</promise>
```
```