# Project rules: Overlook

Overlook audits a coding task an AI agent has already finished: what changed, compared with what was
requested, and whether the agent's report is true. **Evidence decides, Bob explains.** Git computes every
fact; Bob interprets the request, the claims and the impact.

1. **Commit after every sub-task** with a short imperative message. The map replays commits as steps, so
   small commits make audits of this repo readable too.
2. **Never commit secrets**, tokens, `.env` files or IBM Cloud credentials.
3. **`engine/` has no npm dependencies.** Node.js 22+, ES modules, git through `child_process`.
   No model call ever decides a fact in `engine/`.
4. **`ui/` is static**: plain HTML, CSS and ES modules, no build step, English only. It must work without
   the local server (sample only) and with it (`npm run site`, full audits).
5. **Keep the sample reproducible.** If you change `samples/make-sample-repo.sh`, `engine/collect.mjs` or
   `engine/build-city.mjs`, regenerate `samples/city.sample.json` and run `npm test`.
6. **Data contracts live in `SPEC.md` section 3** and `schema/audit.schema.json`. Change them there first.
7. Record every Bob task in `bob_sessions/` (see `bob_sessions/README.md`).
