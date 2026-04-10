---
name: session-wrap
description: >
  End-of-session memory update + /compact reminder for bantang-app.
  Use when the user types /wrap, or asks to "wrap up", "save progress",
  or "compact 壓縮" after finishing a round of fixes or feature work.
  Updates MEMORY.md with new features, bug fixes, and pending items,
  then prompts the user to run /compact.
user-invocable: true
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# Session Wrap-Up Skill

Use this skill when the user types `/wrap` or asks to save progress before compacting.

## Goal

Capture what changed this session → write to memory → remind user to `/compact`.

## Steps

### 1. Discover what changed this session

Run this to find recently modified source files:
```bash
find /Users/gooo/Desktop/bantang-app/src -name "*.ts" -o -name "*.tsx" | xargs ls -t 2>/dev/null | head -20
```

Also check non-src files that commonly change:
```bash
ls -t /Users/gooo/Desktop/bantang-app/firestore.rules \
       /Users/gooo/Desktop/bantang-app/storage.rules \
       /Users/gooo/Desktop/bantang-app/firebase.json 2>/dev/null
```

### 2. Read current memory state

Read the memory index and any relevant memory files:
- `/Users/gooo/.claude/projects/-Users-gooo-Desktop-bantang-app/memory/MEMORY.md`

### 3. Categorize changes

For each changed file, classify it as one of:
- **新功能** (new feature) — new component, new API function, new Firestore collection
- **Bug fix** — corrected broken behaviour, added missing error handling
- **效能 / 重構** — optimization, useMemo, precompute, memory leak fix
- **待辦** — something incomplete, needs follow-up, or requires manual action

### 4. Update MEMORY.md

Append a new sub-section under `## 已完成的重要修正（依時間順序）` with the format:

```markdown
### [功能名稱]（已部署）
- **[檔案]**: 簡短描述做了什麼、為什麼
- **⚠️ 注意**: 若有需要手動操作的步驟（如 Firebase console 開啟功能、領班重新同步課表）請列在這裡
```

If new Firestore collections or fields were added, update the `## Firestore 關鍵 Collections` section.

If there are new pending items, update `## 已知待辦事項`.

### 5. Print session summary

Output a clean bullet-point summary of what was recorded:

```
✅ Memory updated — 本次 session 記錄：
  • [feature 1 in 1 line]
  • [bug fix in 1 line]
  • ⚠️ [pending action if any]

💡 現在請輸入 /compact 壓縮此 session 的 context。
```

## Rules

- Do **not** rewrite existing memory sections — only append or extend
- Keep entries concise (1–2 lines each) — link to code, don't duplicate it
- If nothing meaningful changed (e.g. only a conversation), say so and skip the update
- Never remove the `## 已知待辦事項` section — only add to it
