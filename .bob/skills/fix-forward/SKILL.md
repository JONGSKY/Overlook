---
name: fix-forward
description: >-
  After a review, revert the out-of-scope changes and re-implement the request
  inside the requested area
metadata:
  user-invocable: true
  disable-model-invocation: true
  argument-hint: '<audit id> [decisions.json]'
---

Switch to the Overlook Fixer mode (`/overlook-fixer`) and follow `.bob/rules-overlook-fixer/01-fix-forward.md`
for audit `$1` with decisions `$2` (default `out/decisions.json`).
