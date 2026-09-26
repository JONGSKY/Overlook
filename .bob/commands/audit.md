---
description: Audit a finished agent task and open it on the Overlook map
argument-hint: <repo path> <base sha> <brief path> "<agent report>"
---

Switch to the Overlook Auditor mode (`/overlook-auditor`) and audit the finished task.

- Repository: $1
- Base commit: $2
- Request brief: $3
- Agent's final report: $4

Follow `.bob/rules-overlook-auditor/01-evidence-first.md` end to end: collect evidence, run the four
subagents in parallel, write `out/audit.json`, build and publish with `overlook_build`, then show the map
link and the receipt.
