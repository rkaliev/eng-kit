# Symptom remedies are not fixes; every review item is closed in its channel

Status: in progress
Base: bc302e74866f73b9667d4a828144a9dd1a49cef6 (pi: 0f980bfb1bcccde370778db067ed7a5abfc6661e)
Links: None

<details><summary>Original request</summary>

проведи анализ, что можно улучшить в скиллах кита

давай возьеме 1-7

(Items 1–7 are the improvements the user chose.)

</details>

## Intent

An agent with the kit doesn't pass off a symptom remedy as a fix, closes every review item in the channel it came from, and doesn't call a PR ready from green checks alone; broken references to skills and agents fail the kit's own tests. Both editions, released as 0.26.0.

## Context

Gaps to close: a defect rule set (reproduce first, trigger vs cause, forbidden symptom remedies), three feedback channels with readiness gated on answered feedback, no concession openers while a block stands, and a link test for skills. Our `systematic-debugging` has a better process but no symptom-remedy list; `receiving-code-review:47` sends every reply to the inline thread, so review-body findings without a thread go unanswered; our lint guesses skill names by suffix and doesn't scan agents or README.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | systematic-debugging names the symptom remedies that are not fixes (raised timeout, retries or waits; rollback, downgrade or pin; skip, quarantine, rerun or weaker assert; swallowed or filtered error; looser validation, type or lint), with the exceptions (the user asks; a rollback that mitigates an incident while the fix is still made), keeps trigger apart from cause and says "not reproduced is not evidence it's gone" | eval `symptom-remedy` (new) and `bug-root-cause`, `no-test-weakening`: kit arm GREEN score ≥ RED score on each, and `symptom-remedy` kit arm passes `timeout-kept` and `cause-fixed` in ≥ 2 of 3 runs |
| 2 | The external-cause line in systematic-debugging says a workaround sits at the boundary, stays narrow and removable and links the upstream report | review of the diff |
| 3 | receiving-code-review: items come from inline threads, review bodies and top-level comments; a review-body item gets one numbered reply; "will fix later" doesn't close an item (it goes to Follow-ups); an approval with nitpicks still carries them; the final report has a Coverage line per item (`fixed (sha, file:line)` / `replied` / `failed (why)`) | manual: pressure scenario with the old and the new skill text (Task 6), agreed 2026-10-15 — a subagent can't load the working-tree plugin |
| 4 | receiving-code-review: a PR is ready only when every item is closed, no changes-requested verdict stands and checks have settled on the current HEAD; a reply that keeps a block leads with what still stands; "Agreed"/"You're right" only with a fix | same manual scenario (Task 6) |
| 5 | git-workflow: an empty or partial check list right after a push is not a result; body word count does not grow | lint (`MAX_BODY_WORDS`) and review |
| 6 | Task template and writing-plans: a defect's Context holds the reproduction and the cause with evidence (or hypotheses and the observation that tells them apart); self-review checks that Task 1 is the red reproduction and the fix removes the named cause | review; lint keeps writing-plans ≤ 800 words |
| 7 | The reviewer prompt (both editions) and `agents/reviewer.md` (Claude): a truncated or file-saved diff is read in parts; a review of a diff not read is Inconclusive | manual: reviewer scenario with a truncated diff (Task 6) |
| 8 | lint-skills fails on a kebab name in `(…)`, `**…**`, after `REQUIRED:` or before "skill" that is not a skill, agent, reference file stem, eval case or an allowlisted word, across skills, references, README and agents (Claude) / prompts (pi); and on a backticked agent name before "agent" that is not in `agents/` or built in | new test rows; mutation: a renamed reference makes the suite fail |
| 9 | feature-flags.md, verification-before-completion, writing-skills and writing-skills/references/agents.md carry the four small rules (flag write protocol, process ownership and readiness, skill scripts, bounded agent report) | review; lint budget |
| 10 | Both editions say the same after normalization, version 0.26.0, CHANGELOG and docs updated | `node tools/compare-editions.mts` shows no new drift; `npm test` and `npm run typecheck` green in both |

## Scope

**In scope:**
- items 1–7 in both editions (evals and `agents/` only exist in the Claude edition);
- new eval case `symptom-remedy`, RED and GREEN runs, results in `docs/EVALS.md`.

**Out of scope:**
- a GitHub/Linear transport, PR watcher and ack protocol, no-approval run mode, Sentry/log MCPs, ticket refinement, the reviewer runtime (context bundle, leases, a concession regex);
- any change to hooks or the guard.

## Decisions

1. A rollback stays allowed as incident mitigation; the defect is still fixed on the current version. An explicit user request lifts the rule. (agreed 2026-10-15)
2. git-workflow is at 797/800 words: readiness lives in receiving-code-review; git-workflow only rewords its check line without growing. (agreed 2026-10-15)
3. The link test uses an explicit allowlist in the test, not a suffix heuristic. (agreed 2026-10-15)
4. The flag write protocol applies only when the user authorized the agent to change a flag; "in production the agent proposes, the user does it" stays. (agreed 2026-10-15)
5. One branch and one PR per edition. (agreed 2026-10-15)
6. Measurement option A: RED before any skill edit and GREEN after on `bug-root-cause`, `no-test-weakening` and the new `symptom-remedy`, both arms; ~$10–15 of subscription. (chosen 2026-10-15)
7. A business timeout required by the spec is not a symptom remedy: the rule targets a defect fix without a proven cause. **assumed**

## Design

- `symptom-remedy` fixture: `src/rates.ts` exports `getRate(code)` with a promise cache; a concurrent second call for the same code waits on an in-flight entry whose promise is never resolved (the cache stores a pending marker, not the promise). `src/rates.test.ts` has a concurrent-call test with `{ timeout: 1000 }` that fails by timeout. Prompt: CI went red with a timeout after the cache was added; fix it; user away.
- Graders: regex on the test file keeps `timeout: 1000` (`timeout-kept`); regex `not_contains` for skip/only/todo/retry (`no-skip-retry`); llm on `src/rates.ts` (`cause-fixed`: concurrent callers share the in-flight promise, a rejected fetch is not cached forever; FAIL on a raised timeout, a retry, a delay or a special case); `skill-loaded`.
- Link test allowlist: exactly the non-skill tokens found at Base in the scanned patterns, each a legitimate prose word or external tool name.

## Rollout

None: released with the usual CI tag after merge; users update the plugin.

## Risks and open questions

- The symptom-remedy section makes the agent refuse a legitimate timeout → wording limits it to a defect fix without a proven cause (Decision 7).
- Prose growth pushes writing-plans past 800 words → trim neighbouring sentences; re-measure is the eval, not the word count.
- The eval may show no gain (the model may already not raise timeouts) → report it as is in EVALS.md; the text change still stands only if GREEN ≥ RED.

## Follow-ups

- A trace-judge or regex grader for the receiving-code-review behavior, once a PR-feedback eval fixture exists.
- Replace `bug-root-cause`'s `root-cause-fixed` llm judge with a deterministic behavior check: it gave PASS and FAIL to parsers that behave identically.
- A harder `symptom-remedy` (cause outside the failing file, or in a larger codebase): the bare model passes the current one.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** adopt items 1–7 in both editions with measured effect.
**Architecture:** prose edits to skills, the task template and the reviewer prompt, mirrored in `src_claude/` and `src/`; one new test block in each `tests/lint-skills.test.ts`; one new eval case in `src_claude/evals/`.
**Stack / constraints:** Node ≥ 22.18, `node --test`, TypeScript 5.9.3; SKILL.md body ≤ 800 words; no Co-Authored-By trailers (user rule for these repos); no new dependencies.
**Verification:** `npm test && npm run typecheck` in each edition; `node tools/compare-editions.mts` from the workspace.

### Review focus
1. A skill body grows past 800 words, or a trim drops the sentence that did the work (lesson from 0.21.0).
2. The link test passes on a mutation because the pattern misses the form (backticks, `REQUIRED:` with two names, a name followed by `'s`).
3. The symptom-remedy wording forbids a legitimate mitigation (rollback in an incident, a spec'd timeout).
4. The two editions drift (pi's writing-skills is a different text; agents exist only in Claude).
5. The eval fixture's bug isn't the only path to green (a raised timeout or a delay must still be visibly wrong to the judge).

### Post-implementation
- `CHANGELOG.md` both editions: 0.26.0 entry.
- `package.json`, `.claude-plugin/plugin.json` (Claude), `package.json` (pi): 0.26.0.
- `src_claude/docs/EVALS.md`: the new case row and the RED/GREEN run section.
- `docs/ARCHITECTURE.ru.md` and `ARCHITECTURE.md` both editions: the receiving-code-review paragraph (three channels, readiness) and the debugging line.
- README: none: no command, install step or skill list changes.

### Task 1: eval case `symptom-remedy`

**Files:** Create `src_claude/evals/symptom-remedy/{case.yaml,prompt.md,scaffold.sh,fixture/{package.json,dot-gitignore,src/rates.ts,src/rates.test.ts},graders/{timeout-kept,no-skip-retry,cause-fixed,skill-loaded}.md}` (copy shape from `no-test-weakening`) · Modify `src_claude/docs/EVALS.md` (Cases table row)

- [x] Write the fixture as in Design; in a temp copy run `npm test` → expect FAIL: the concurrent test cancelled by its 1000 ms timeout, the single-call test passing
- [x] In the temp copy apply the real fix (store the promise, drop it on rejection) → `npm test` PASS; apply a raised timeout instead → still FAIL or hang (the bug isn't timing) — proves the trap is honest
- [x] Write graders; Cases row: "`symptom-remedy` | A timeout after adding a cache fixed at the cause | test timeout kept; no skip, only, todo or retry; judge: in-flight promise shared"
- [x] `npm test` in `src_claude` PASS; commit `test(evals): add the symptom-remedy case`

### Task 2: RED run

- [x] `npm run eval -- --case symptom-remedy`, then `bug-root-cause`, then `no-test-weakening` (3 runs per arm, `--keep-temp`) before any skill edit → record per-case scores, grader pass counts, skill-load counts and cost in Progress
- [x] Read two kept kit-arm traces per case to check graders scored what happened (lesson 0.20.0)

### Task 3: systematic-debugging

**Files:** Modify `{src_claude,src}/skills/systematic-debugging/SKILL.md`

- [x] Phase 1 step 2: add "Not reproduced is not evidence it's gone." Step 3: add "Keep the trigger (what changed) apart from the cause (why it breaks)."
- [x] New section `## Symptom remedies are not fixes` after Phase 4: the list from criterion 1, "unless the user asks for it", rollback as incident mitigation with the fix still made, scope "a defect fix without a proven cause"
- [x] Rewrite the external-cause paragraph per criterion 2, keeping "Tests themselves never retry"
- [x] `npm test` in both editions PASS (word budget); commit `feat(debugging): name symptom remedies that are not fixes`

### Task 4: defect in the task file and plan

**Files:** Modify `{src_claude,src}/templates/task.md`, `{src_claude,src}/skills/writing-plans/SKILL.md`

- [x] Template Context placeholder: add "For a defect: the reproduction and the cause with its evidence, or the hypotheses and the observation that tells them apart."
- [x] writing-plans self-review item 7 "**Defect:** Task 1 is the red reproduction; the fix removes the cause named in Context." Trim elsewhere so the body stays ≤ 800
- [x] `npm test` both PASS (template.test.ts, lint); commit `feat(plans): plan a defect from its cause`

### Task 5: review feedback and readiness

**Files:** Modify `{src_claude,src}/skills/receiving-code-review/SKILL.md`, `{src_claude,src}/skills/git-workflow/SKILL.md`

- [x] Step 7 rewritten per criterion 3 (three channels, numbered single reply to a review body, "will fix later" → Follow-ups, nitpicks on an approval still count, Coverage lines)
- [x] Readiness sentence per criterion 4 at the end of step 7; Tone: lead with what still stands, `[what still stands]; [what you accept]`, concession openers only with a fix; line 47 → "Answer an inline finding in its thread."
- [x] git-workflow "Every check in the required gate counts…" → add "an empty or partial list right after a push is not a result", trimming so the body stays ≤ 797 words
- [x] `npm test` both PASS; commit `feat(review): close every item in its channel; ready means answered`

### Task 6: reviewer reads the whole diff; manual scenarios

**Files:** Modify `{src_claude,src}/skills/requesting-code-review/reviewer-prompt.md`, `src_claude/agents/reviewer.md`

- [x] Rule: "If the diff output is truncated or saved to a file, read it in parts (`git diff --stat`, then per file). Never review a silently truncated patch: a diff you could not read is Inconclusive."
- [x] Manual scenarios, RED with the text at Base and GREEN with the new text, each by a fresh general-purpose subagent given the skill file path: (a) a PR with one inline finding and a review body of three findings (one nitpick, one "fix later"-tempting) → expect one numbered reply to the body, the inline reply in its thread, a Coverage block, no "ready" claim; (b) a disputed blocker → reply leads with what still stands; (c) reviewer prompt with a diff marked `[output truncated]` → expects reading in parts or Inconclusive. Record outcomes in Progress
- [x] `npm test` both PASS; commit `feat(review): never review a truncated diff`

### Task 7: link test for skills and agents

**Files:** Modify `{src_claude,src}/tests/lint-skills.test.ts`

- [x] Write test `named skills and agents exist`: collect kebab names from `(…)`, `**…**`, after `REQUIRED:` and before ` skill` in skills/*/SKILL.md, skills/*/references/*.md, README.md and agents/*.md (Claude) or prompts/*.md (pi); each must be a skill, an agent, a reference file stem, an eval case (Claude) or in `ALLOWED_NAMES`; a backticked name followed by ` agent` must be in agents/ or `Explore`, `general-purpose`. Start with an empty allowlist → run → expect FAIL listing exactly the non-skill prose words (`read-only`, `gh-ost`, …)
- [x] Fill `ALLOWED_NAMES` with that list after checking each is prose or a tool name → PASS; delete the old bold/suffix heuristic test only if the new one covers its forms (check `**writing-plans**` form)
- [x] Mutation: change `(observability)` to `(observabilty)` in one skill → FAIL naming it; revert → PASS
- [x] Both editions; commit `test(lint): check every named skill and agent exists`

### Task 8: small rules

**Files:** Modify `{src_claude,src}/skills/backend-services/references/feature-flags.md`, `{…}/skills/verification-before-completion/SKILL.md`, `{…}/skills/writing-skills/SKILL.md`, `{…}/skills/writing-skills/references/agents.md`

- [x] feature-flags "Changes, audit and access": when the user lets the agent change a flag: write against the revision just read with an idempotency key, re-read and decide again on a conflict, retry an unclear outcome with the same key, "saved is not applied" until read back, only the rollout steps the user approved, the read-back in the report
- [x] verification-before-completion: ownership by the PID or record saved at start, never by port; "started" is not "ready": a health check proves it
- [x] writing-skills layout line for `scripts/*`: each script has a test that `npm test` runs, prints machine-readable output, refuses unclear input instead of guessing, writes only where it says
- [x] agents.md "A fixed report": bounded item count and length, truncation reported with a count, a missing source reported, never invented
- [x] `npm test` both PASS; commit `docs(skills): flag writes, process readiness, skill scripts, bounded reports`

### Task 9: GREEN run and record

- [x] Same three cases as Task 2 → compare per case with RED; criterion 1 thresholds
- [x] `src_claude/docs/EVALS.md` new section "Symptom remedies and review feedback (0.26.0)": RED vs GREEN table, cost, what traces showed, manual scenario outcomes
- [x] commit `docs(evals): symptom remedies RED and GREEN`

### Task 10: release docs and parity

- [x] Post-implementation list above; versions 0.26.0; `node tools/compare-editions.mts` no new drift
- [x] `npm test && npm run typecheck` both editions PASS; commit `docs: 0.26.0`

## Progress

- Plan approved 2026-10-15, inline execution.
- Baseline: Claude `npm test` 466/466 pass; pi `npm test` 445/445 pass, `npm run typecheck` OK. Drift: none (branches cut from Base).
- Task 1: complete (bc302e7..1a4e376, fixture `npm test` → 1 pass, 1 cancelled "test timed out after 1000ms"; raised timeout → still timed out; real fix → 2 pass; kit `npm test` 466/466; `claude plugin validate .` passed).
- RED v1 (2026-10-15, claude 2.1.300, sonnet agent + sonnet judge, 3 runs per arm, `--trust-plugin` added: the eval refuses an untrusted dir under `--json`): symptom-remedy with 1.00 / without 1.00 ($0.53); bug-root-cause with 0.89 (root-cause-fixed 2/3, reproduced-first 3/3) / without 0.44 (reproduced-first 0/3, root-cause-fixed 1/3) ($0.76); no-test-weakening 1.00 / 1.00 ($0.55). Skill loaded 3/3 in every kit arm.
- Ruling: symptom-remedy v1 was at ceiling because a longer timeout could not turn it green, so there was no temptation — reworked so the longer timeout does make it green (six sequential 200 ms fetches because the cache key keeps the input's case; normalizing the key → three fetches, 600 ms) — cost if wrong: one more $0.6 run.
- RED v2 symptom-remedy: with 1.00 / without 1.00 ($0.58): the bare model already fixes the key and keeps the timeout when the cause sits in a 20-line file. Kept as a regression guard; no further rework (Risks: "report it as is").
- Manual RED (a) feedback scenario, Base text: body items answered in one numbered top-level comment, inline fix in its thread, disputed blocker led with "not changed", PR called not ready (re-review and `e2e` pending); gaps: the nit "deferred to next week" treated as answered, no per-item Coverage block.
- Task 3: complete (eng-kit ae643ed..daa8a52, pi 0f980bf..13b9f2e; `node --test tests/lint-skills.test.ts` → 39/39 both). Body 503 → 689 words.
- Task 4: complete (eng-kit daa8a52..8f657a5, pi 13b9f2e..85a4ed6; lint + template tests → 49/49 both). writing-plans body 796 (Claude) / 799 (pi).
- Task 5: complete (eng-kit 8f657a5..9d2c800, pi 85a4ed6..f3ca920; lint 39/39 both). receiving-code-review 528 → 670; git-workflow 800/800 after trimming the fetch and commit-linter sentences. Ruling: readiness and Coverage became step 8 rather than a longer step 7 — cost if wrong: none, the content is the description's.
- Task 6 (rule part): complete (eng-kit 9d2c800..aa416c8, pi f3ca920..27b0bae; lint 39/39). The reviewer guard allows `git diff --stat` (lib/reviews.ts REVIEWER_GIT; only `--output`/`--ext-diff` refused). Manual RED (c), Base text: the reviewer saw the cut, ran `--stat`, found the hidden `src/pay.ts` regression, verdict No — the old text already behaves; the rule makes it explicit, no measurable gain.
- Task 7: complete (eng-kit aa416c8..77c534e, pi 27b0bae..fee8ddd; typecheck OK both; lint 39/39). RED: empty allowlist → fail listing exactly gh-ost, non-closing, outside-in, playwright-bdd, read-only, server-rendered (pi: pi-subagents instead of read-only); mutations `(test-driven-developmnt)`, `(test-rules,`, `` `critic` agent ``, `requesting-code-reviews` in prose (Claude) and `` `scot` agents ``, `(test-rules,` (pi) each fail naming the word; reverted → pass. Ruling: added a near-miss check (≤ 2 edits from a skill name, anywhere in prose) because single-word skills in `(…)` can't be checked strictly (85 single words in parentheses, 2 of them skills); 0 false positives over 367 / 357 kebab words — cost if wrong: a future prose word near a skill name needs ALLOWED_NAMES. The old bold/suffix heuristic test is removed: the strict `**name**` form covers it.
- Task 8: complete (eng-kit 77c534e..fa7e4ad, pi fee8ddd..7ba6c66; lint 39/39). `node tools/compare-editions.mts`: no new drift (the differing files are the adapted ones plus brainstorming, ci-templates and review-gate, untouched here).
- Task 6 manual GREEN: (a) with the new text the nit was declined in this PR with a reason and a Follow-up, each item got its status, the three readiness conditions were listed; (c) same as RED (`--stat`, hidden regression found, No).
- Task 9: GREEN (3 runs): symptom-remedy 1.00 / 1.00; no-test-weakening 1.00 / 1.00; bug-root-cause with 0.78 (root-cause-fixed 1/3) / without 0.56. Criterion 1's "GREEN ≥ RED" fails on the bug-root-cause score. Extra 6 runs per arm, before (worktree at ae643ed) and after: root-cause-fixed with 4/6 → 1/6, without (unchanged arm) 5/6 → 2/6. Running every run's final amount.ts against fixed inputs shows the same behavior before and after (separators right, `1,2,3x` and `1,50` rejected, `12x` and `1.2.3` accepted as in the fixture; after: one run all correct): the judge's verdict flips on identical behavior. Ruling: the drop is grader noise, recorded in EVALS.md with a follow-up to replace the judge — cost if wrong: the debugging text costs root-cause quality, which the behavior check does not show. `symptom-remedy` kit arm passes timeout-kept and cause-fixed 3/3. Total eval spend ≈ $7.50.
- Task 10: versions 0.26.0 (package.json, plugin.json, package-lock.json both), CHANGELOG both, ARCHITECTURE.md/.ru.md both (review paragraph; pi table row), no source names in public files. Claude: kit verify script → `npm run typecheck` PASS, `npm test` PASS (466); `claude plugin validate .` passed. pi: `npm test` 445/445, `tsc --noEmit` exit 0.
