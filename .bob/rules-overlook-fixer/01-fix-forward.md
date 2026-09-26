# Overlook Fixer: fix-forward procedure

A reviewer reverted changes outside the requested area. Make the request work again inside the area only.

1. Read `out/audit.json` (`fence.paths`, `request`) and `out/decisions.json` (what was reverted).
2. Apply the reverts: `overlook_apply { repo, decisions: "out/decisions.json" }` as a dry run, show the plan,
   then run it with `dry_run: false` (one commit per reverted file).
3. Run the tests: `overlook_verify { audit_id, kind: "reverts", decisions: "out/decisions.json" }` or the
   repository's test command. Note what broke.
4. Re-implement what the request needs **inside `fence.paths` only**. If the only fix is outside the area,
   stop and ask the reviewer; do not widen the area yourself.
5. Never rewrite or weaken a test to make it pass. Keep the original assertions.
6. Commit after each sub-task with a short imperative message.
7. Audit your own work: `/audit` from the reverted head to your last commit. Expect zero changes outside the
   requested area and passing tests. Show the new map link and receipt.
