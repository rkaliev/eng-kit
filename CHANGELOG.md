# Changelog

## 0.33.0

- **Files the agent writes are in English.** using-skills' "Always true" says it: docs, plans, decision records, commits, PRs, code comments, test names and logs are in English whatever language the user talks in or the repo's older docs use. Exceptions: product UI text, verbatim quotes such as a task file's original request, documentation for people that the user asks for in their language, and an edit inside a file already in another language, which keeps that file's language. writing-documentation no longer follows the repo's docs language, the docs entry point follows only its structure, the manifest template drops the test-name language, and the review checklist checks the language of agent-written text, and the `implementer` subagent, which never loads using-skills, carries the rule itself. The bootstrap stays within 800 words: four sentences that repeated another line went. A new eval, `docs-language`: asked in Russian, in a repo with a Russian decision record, to record a decision, commit it and write a Russian note for the client. On 0.30.0 the new record came out in Russian in 6 of 6 runs, with and without the kit; on 0.31.0 every run with the kit wrote it in English, kept the client note in Russian and kept the old record (1.00, without 0.78), and a re-run on the final text did the same (1.00, without 0.83). A full run of the suite, one run per case, loaded a skill in 12 of 13 cases with the kit, as before (`verify-before-done` never loads one).

## 0.32.0

- **Review rounds converge.** The reviewer runs one of three rounds and checks its conditions itself. Full reviews the branch from the merge-base. Repeat reviews only what is new and re-checks every earlier finding; code an earlier conclusive round reviewed, which the range neither changes nor newly reaches, gets a new finding only at Critical, and anything less is listed as `missed earlier` for the author's Follow-ups. Prose, in a repeat round after a `Yes` when only prose changed (task files, Markdown in `docs/` except decision records, README, CHANGELOG), checks that the text is true of the code, keeps the project's rules and holds no secret or personal data (SEV-01, SEV-09, SEC-03); an agent rule, a file the manifest names as rules, a file the code, build or tests read, or a code file in the range, by its old path too when renamed or deleted, makes it a Repeat round. The review gate is unchanged: every landed commit still needs a recorded `Yes`.
- **IDs for rules and findings.** Every checklist rule has a stable ID (`SEV-03`, `COR-01`…; a removed ID moves to a `Retired IDs` line and is never reused, and a test checks that each section's IDs in use and retired run 01..highest), cited in brackets in a finding. Findings are numbered `F<n>` across the rounds of a chain, and `scripts/review-log.ts` prints the round number since the last `Yes` and the earlier rounds back to the remote base, with their verdicts. review-log also names the highest finding ID in the chain, so a new finding never reuses an old one. Parallel reviewers number their findings with their own prefix (`F`, `S` security, `T` tests, `C` other), and a Full round that follows earlier rounds (a rebase, a failed run, a restart) carries on the round count and IDs from the branch's last reviewed HEAD (`{PREVIOUS_HEAD}`).
- **The author stops when rounds don't converge.** receiving-code-review: when one finding is still open after two fixes, or Critical or Important findings are open after round 3 since the last `Yes`, the agent asks the user, with the finding's history and a choice of a named fix, a design rethink, the user's ruling, or a follow-up (never for a Critical). A finding the user moves to Follow-ups reaches the reviewer as their quoted ruling and no longer holds the verdict in any round (never a Critical). After a `Yes`, Minor findings go to Follow-ups instead of new commits.
- **Two new evals.** `review-round-cap`: a finding open after two fixes in the third round; with the kit every run stops and asks with options (1.00), without it no run asks (0.67). `minor-after-yes`: a `Yes` with two Minor findings; with the kit both go to Follow-ups and `src/` stays untouched (1.00), without it every run fixes them (0.33).

## 0.30.0

- **Publishable documents.** A new skill, `publishing-documents`, for a PDF or single-file HTML that goes to a reader outside the repo: project docs for a partner or auditor, a report or proposal, client release notes. The source stays Markdown in the repo: chapters of `docs/` chosen, never copied; a document in `docs/publish/` with its metadata in the frontmatter; or one CHANGELOG version. `scripts/publish.mts` (Node, no dependencies; pandoc ≥ 3.8, Typst, and mermaid-cli for diagrams) reads every source as GitHub-style Markdown into pandoc's tree; before writing anything it checks the tools, links, anchors, images and raw HTML, gives each chapter its own anchors, renders diagrams to SVG with their `accTitle` as alt text, and builds both files in the project's theme: a cover with title, audience, version and date, contents, a running header and page numbers. `--init-theme` copies the kit's theme into the project, which owns it from then on. A link into the repo fails the build unless `--drop-repo-links` or `--repo-url`; any failed check lists every finding and writes nothing. Before handing a file over, the agent removes what that reader must not see, lists gaps without guessing, and looks at every page; sending is the user's. Asked for a partner PDF without the skill, an agent left out the internal chapters but built a plain PDF from a hand-edited copy and checked one page; with it, it chose chapters, built both files with the theme, left the team's docs unchanged and looked at every page.

## 0.29.0

- **A docs site from `docs/`.** writing-documentation points to `references/docs-site.md`: the text stays in `docs/` and the site config holds only the theme, menu and base path; the menu is built from the chapter files, not typed into the config; a folder is linked through its `README.md`, served as its index, and links to code are rewritten to the repo host, because on the site they are a 404 that neither generator flags; task files stay off the site; VitePress for JS/TS projects and Zensical for other stacks, after checking the tool is maintained; a strict build that the `gate` job depends on, `lychee --offline --root-dir` on the output and the `mmdc` check in CI; who may read the site (PR previews included) and when it updates are agreed with the user before a deploy. One example config, built as written. `references/checks.md` adds a "Docs site builds" row. Asked to put `docs/` on GitHub Pages without the reference, an agent typed the menu into the config, rendered diagrams in the browser with no check, and replaced a dead link with the unverified claim it supported; with it, the menu came from the files, CI ran the index check, `mmdc`, the strict build and lychee, and the claim was removed.

## 0.28.0

- **Diagrams in documentation.** writing-documentation says to draw what prose can't show plainly (calls between components, failure paths, states) and points to `references/diagrams.md`: Mermaid in the Markdown by default (a plain-text drawing only where Mermaid doesn't render, images only generated from a committed source), which diagram type for which question, names as in the code, one idea and about 12 nodes per diagram, labelled arrows, limits by the name of the setting rather than a copied number, failure paths, one sentence with the takeaway, rendered before the doc is called done, updated in the same change as the code. `references/checks.md` adds a render check (`mmdc`; a docs site build counts only if it fails on a broken diagram). An agent documenting a webhook flow without the rule wrote steps and tables but no diagram; with it, a sequence diagram with every failure branch.

## 0.27.2

- **A new eval, `review-feedback`:** PR feedback in an inline thread, a review body and a top-level comment. With the kit every run answers the review body in one numbered reply, opens no reply with praise and closes every item (1.00); without it 0.71 (no run without praise in the opening, one numbered reply in 1 of 3). Its fix is also checked by behavior, and two graders check that the claimed changes exist. The grader tests read a regex grader's `flags`.
- `docs/EVALS.md` records that a harder `symptom-remedy` (the cause two layers down, a plausible external cause in the logs) didn't trap the bare model either.

## 0.27.1

- **The behavior check runs model-written code with less reach.** `scripts/eval-behavior.ts` runs each run's final file outside the eval's sandbox; the child process now gets no environment but `PATH`, so your tokens aren't in it, and Node's permission model (`--permission`): it may read only its own temp folder, the case's folder and the runner, may not write files, start processes or load addons, and `node:sqlite`, which writes files past the permission model, is off. Not covered: the network, including local sockets (a reachable daemon such as Docker can still touch your files for that code), and signals to your processes. Node calls its permission model a seat belt, not a sandbox, so run the check only on your own eval results, and in a container or VM for results you don't trust.

## 0.27.0

- **Opus at xhigh for reasoning, code and review.** The `implementer` agent now runs on `opus` at `effort: xhigh` (was `sonnet`), like the reviewer, and test-driven-development, executing-plans, implement, changing-legacy-code, requesting-code-review and receiving-code-review set `effort: xhigh`, joining brainstorming, writing-plans, systematic-debugging and security-review. Other skills run at the session's effort. Subagent-per-task execution costs more than before.
- **Evals judged by behavior.** `scripts/eval-behavior.ts <results.json>` runs a case's `behavior.ts` on every run's final file (taken from the results of `claude plugin eval --json`) in a child process with a timeout, and prints per arm how many runs had no violation. `bug-root-cause` has one: on the 0.26.0 runs the kit fixed the root cause in 9 of 9 runs before and after, so that release's judge drop was noise.
- **A new eval, `spec-timeout`:** a hanging test where the spec requires a 2 s timeout. Both arms add it (1.00, behavior 3 of 3): the symptom-remedy rule doesn't stop a timeout the requirements set.
- **writing-plans has room under its word budget** (775 words, was 796); no rule removed.

## 0.26.0

- **Symptom remedies are not fixes.** systematic-debugging names what makes a defect's symptom go away without a proven cause: a raised timeout or an added retry, wait or sleep; a rollback, downgrade or pinned version; a skipped, quarantined or re-run test or a weaker assertion; an error caught and dropped or filtered out of logs; a looser validation, type or lint rule. Each is allowed only when the user asks for it (reported as a remedy, with the unproven cause in Follow-ups) or when a rollback, confirmed by whoever owns the release, mitigates a live incident and the defect is still fixed on the current version; a timeout the requirements set is a requirement, not a remedy. Phase 1 now keeps the trigger (what changed) apart from the cause, and says a failure that no longer reproduces is not evidence it's gone. An external cause is handled at the boundary on the current version, with a narrow, removable workaround that links the upstream report (a pin to the last good release counts when that report proves the regression).
- **A defect is planned from its cause.** The task file's Context holds a defect's reproduction and its cause with evidence (or the competing hypotheses and the observation that tells them apart), and writing-plans' self-review checks that Task 1 is the red reproduction and the fix removes that cause.
- **Every review item is closed where it was raised.** receiving-code-review: feedback comes from inline threads, the review's own body and top-level comments. An inline finding is answered in its thread, a review body's items in one numbered reply. "Will fix later" doesn't close an item (fix it, or decline it and add a Follow-up), and nitpicks on an approval still count. The report has one coverage line per item (`fixed`, `replied` or `failed`). A PR is ready only when every item is closed, no changes-requested verdict stands and all required checks have passed on its current head. A reply that keeps a block leads with what still stands, and any opening agreement ("Agreed", "You're right", "Fair point") comes only with a fix. git-workflow: an empty or partial check list on the current head is no result yet.
- **The reviewer reads the whole diff.** A diff whose output is cut short or saved to a file is read in parts (`git diff --stat`, then one file at a time); a range the reviewer could not read is Inconclusive.
- **Smaller rules.** feature-flags: when the user lets the agent change a flag, it writes against the revision just read with an idempotency key, retries an unclear outcome with the same key, reads the value back (saved is not applied) and ramps only through approved steps. verification-before-completion: a process you started is known by its process id or record, not its port, and a health check, not the start, proves it ready. writing-skills: a skill's script is tested, prints machine-readable output, refuses unclear input and writes only where it says. Agent reports are bounded, count what they left out and never invent a source.
- **The lint checks named skills and agents.** In parentheses, lists, bold, after `REQUIRED:` or "see", before "skill" (backticked too), before `'s` (backticked too) and in SKILL.md tables, the leading name of each list item (after a label such as `REQUIRED:`, quotes or a leading "then") is checked: a hyphenated one must be a skill, an agent, a skill's Markdown file, an eval case or an allowlisted word, and a one-word one fails only when it is one or two edits from a skill name of eight or more letters. A backticked name before "agent(s)" must be a kit or built-in agent. Any hyphenated word one or two edits from a skill name fails as a likely typo. It scans every Markdown file under `skills/`, `agents/` and README; test rows pin each form and that a wrong name is reported.
- **Evals:** a new `symptom-remedy` case (a test over its time budget where a longer timeout would turn it green). The bare model already passes it, so it stays as a regression guard; `docs/EVALS.md` records the before/after runs and why the `bug-root-cause` judge's drop is grader noise.
- **The release check covers pinned install versions.** CI's release check now also fails when the README, `docs/` or `templates/` pin another version of the package in an install source (`git:…/<name>@vX.Y.Z`); this edition pins none.

## 0.25.4

- **A python or node heredoc no longer trips the guard on a comment.** A command that, as a whole, feeds a program to `python`, `python3` or `node` (optionally `-`) through a quoted heredoc (`python3 - <<'EOF'`, the program, the delimiter as the last line) is no longer blocked because a comment or string in the program looks like a shell command (`# old: rm -rf ~/cache`, `'''Don't run rm -r ~/x'''`). The program is code, not shell: the rules that block (a recursive delete outside the project, `--no-verify`, a force push) read only the first line, while every question still reads the whole program, so `DROP TABLE`, `npm publish` or `git push` written out in the code still ask, and your guard.json patterns still match it. A program with a backtick (a node template literal that `execSync` may run) is judged whole, as before. `bash`/`sh` heredocs, an unquoted delimiter, arguments or flags, `-c`, a pipe or anything after the delimiter are judged as before.

## 0.25.3

- **Outside git, a shell write outside the project no longer counts as an edit.** Where the verify gate reads a command's write targets from its text (outside git, past 5,000 files, or once git timed out), a redirection target written as a plain word in bash (no quotes, backslash, glob or `$(…)`) has `~`, `$HOME`, `$TMPDIR`, `$TMP`, `$TEMP` and the variables the command assigns once (`S=…`, `export S=…`) expanded, so `> ~/notes.txt`, `> $TMPDIR/log` or `S=/tmp/x && … > $S/t-$e.log` no longer leave the workspace unverified. Everything else counts as written, as before: `tee` and `sed -i` operands, a quoted or escaped word, a name the command also binds another way (`for d`, `read X`, `then X=…`), names bare (`export HOME=…`) or assigns a value other than the environment's, the shell's own `$_`, `$PWD`, `$OLDPWD`, `~` without `HOME`, a name not followed by `/` (`$OUT.log`), a command with `cd`, `pushd`, `popd`, `source`, `.` or `eval` anywhere in it, or with `export`, `declare`, `local`, `readonly` or `typeset` of anything but `NAME=v`, an unknown part after a folder that holds the project or lies in it (by its real path too), a path rooted differently from the project (`/c/…` from Git Bash), and every PowerShell target.

## 0.25.2

- **Two harmless shapes no longer trip the guard.** A recursive `rm` silenced with `2>/dev/null` (or `>/dev/null`, `&>/dev/null`) no longer counts `/dev/null` as a path outside the project, so `rm -rf build 2>/dev/null` and `git rm -rq x 2>/dev/null` pass while `rm -rf ~/x 2>/dev/null` stays blocked. A command that, as a whole, only writes a file through a quoted heredoc (`cat > file <<'EOF'`, `cat >> file`, `tee [-a] file`, then the body and the delimiter as the last line) into a file inside the project or a temp folder is judged by its first line, so writing a script that mentions `rm -r`, `git push --force` or `npm publish` is no longer refused or asked. Its target is judged as a Write to it would be: a write into `.git/` (such as `.git/hooks`) is blocked, and a CI pipeline, the guard config or a secret file asks. A write anywhere else, such as a shell startup file, and every other heredoc and command are judged exactly as before. Your own guard.json patterns still match the whole command.

## 0.25.1

- **Only a real run of the verify script counts.** The verify gate used to treat any command that mentioned `scripts/verify.ts` as a run of the kit's verify script, so with no run record, `cat <kit>/scripts/verify.ts` after an edit cleared the workspace. Now only `node <kit root>/scripts/verify.ts`, as the session context names it and as the command's only step (optionally piped into `tail`, `head`, `grep` or `tee`), counts, also piped into PowerShell's `Select-Object`, `Select-String` or `Tee-Object`; reading or editing the file, a project's own `scripts/verify.ts`, a run after `cd`, chained with `&&` or `;`, or sent to the background with `&` doesn't. The verify skill says to run it as a command of its own.

## 0.25.0

- **The verify gate sees shell edits.** A file changed from the shell (a heredoc, `sed -i`, a script, a code generator, `npm install`) makes the workspace unverified like an Edit or Write. In a git repository the hooks fingerprint the working tree (`git status` plus each listed file's size and time, and `HEAD`) before and after every shell command, failed or in the background, and compare it once more at Stop and on resume; gitignored files and `ignore` globs don't count, staging or committing isn't an edit, and an edit committed in the same command is. A passing command made of checks joined by `&&`, with no redirection into a file (the verify script may be piped into `tail`, `head` or `grep`), keeps its own changes off the count; a write chained with a check (`npm test && sed -i …`), a check piped or followed by `;`, or a failed check's changes count, and a command that changed files credits none of its checks. `git stash` counts. Outside git, in a tree of more than 5,000 listed files, or once git times out in the session, the command's `>`, `>>`, `tee` and `sed -i` targets inside the project count instead. A log written into the project by any other command counts too.
- **Commands are detected when none are configured.** Without `.claude/verify.json` and a Commands section, the gate and the verify script use the commands kit-init would detect from the manifests (package.json scripts, turbo, gradle, cargo, go, dotnet, pytest, make). The review gate (a review on unverified edits is Inconclusive), the reviewer's shell allowlist and the steps allowed before a landing keep using configured commands only. A `.claude/verify.json` that doesn't parse still sends Claude back, now naming the error.
- **No commands at all: a notice, not a send-back.** The Stop hook no longer sends Claude back to "state how it was verified" when there is nothing to run; you get one notice per session to run kit-init or add `.claude/verify.json`.
- **The send-back keeps the report whole.** When the gate sends Claude back, it asks for the complete final report again (what changed, what you must do next, the checks and their results), since that answer is the last message and all that `claude -p` and CI show. In the evals the rollout steps that 0.24.0 lost with the kit are kept in 3 of 3 runs.

## 0.24.0

- **test-driven-development loads on a spec task.** using-skills' "Where to start" names it for settled requirements (a spec, task file or ticket), before any code. On a "implement this spec" eval the skill loaded in 5 of 11 runs before and 17 of 18 after; in every run where it loaded, the agent saw its test fail on an assertion against a stub before writing the code, and in the runs where it didn't, it took "module not found" as red or ran no test first. The red-flag row "I remember that skill" is gone: the rule above it already says so.
- **Evals:** three new cases where the bare model falls short (`money-currency-exponent`, `db-required-column`, `legacy-change`). The order graders of `tdd-discount` and `bug-root-cause` are regular expressions over the whole trace, so a file written with `Write`, `Edit`, a shell redirection, `tee` or `sed -i` with a single-quoted expression counts alike, a stub before the test no longer reads as code first, and code written before the failing run (recognised by the spec's `RangeError` checks) still fails; `tests/eval-graders.test.ts` checks both patterns. `docs/EVALS.md` records why trace judges are not used for order: a judge sees only the first ~45,000 characters of a trace.

## 0.23.1

- **Background reviewers record their verdicts.** A reviewer running in the background hands its report back through a `SubagentHandback` tool call, and its last message (at most a short summary) has no verdict lines, so the review gate recorded nothing: every such review read as missing and the landing stayed denied. The SubagentStop hook now takes the report from the last hand-back of the reviewer's current run in the subagent transcript; a continued reviewer's earlier hand-backs don't count. A handed-back report is already delivered, so sending the reviewer back can no longer fix it: one without the three verdict lines counts as `Inconclusive` at once.

## 0.23.0

- **Extra effort for hard work.** The `reviewer` agent and the brainstorming, writing-plans, systematic-debugging and security-review skills run at `effort: xhigh` (was `high`): deeper reasoning at a higher token spend. A model without `xhigh` runs it as `high`; `CLAUDE_CODE_EFFORT_LEVEL` still overrides it.

## 0.22.0

- **Token usage in the terminal.** `node <kit>/scripts/statusline-install.ts` sets the eng-kit status line in your user settings (a plugin can't set one): `ctx ▓▓▓▓▓░░░░░ 42% · $1.87 · 5h ▓▓▓▓▓▓▓░░░ 63% ↻14:20 · 7d ▓▓▓▓░░░░░░ 31% · sub 1.2M`. Context use, session cost and the plan's 5-hour and 7-day limits come from Claude Code; bars turn yellow from 50 % and red from 80 % (`NO_COLOR` turns colours off); another status line is replaced only with `--force`.
- **Token ledger per branch.** The SubagentStop and Stop hooks add the tokens of each subagent run and what the session added (read from the transcripts, each message once) to a private ledger per repository and branch in the temp folder, on the branch where they were spent. `node <kit>/scripts/usage-log.ts [branch]` prints a branch's tokens by agent (`main 3.4M · reviewer 2.1M · implementer 800k · total 6.3M`), and `/finish` quotes it.

## 0.21.2

- **Hidden landings are denied.** A landing a heredoc body hides (an apostrophe in the body opens a quote the shell never sees), one inside a substitution in double quotes (`echo "$(cd wt && gh pr create)"`), and one in a `$(…)` or backticks of an unquoted heredoc body (`<<EOF` runs them, so a PR body with `` `git push origin main` `` pushes) is one the guard can't read: run it as its own command. Landings are compared by what they land and how often (not by folder), so a landing-like line in a message or a repeat of a visible landing doesn't stand in for a hidden one; plain text and escaped backticks in an unquoted body don't count. `git commit -m "$(cat <<'EOF' … EOF)" && git push` reads as before.
- **Review records:** zsh's `>!file`, `file -C`, `less -o` and a `$TMPDIR` path with `.` or `//` count as writes into them.
- **A PR create after a move the guard doesn't follow** notes the branch of every folder the command may reach or names (`PR=$(cd wt && gh pr create)` included), so a later push to it is gated.
- The shell parser moved from `lib/reviews.ts` to `lib/shell.ts`; no behavior change.

## 0.21.1

- **The review gate reads the shell more closely.** `>|` and `>& file` take their file name, so `git push >|log origin HEAD:main` is a push of `HEAD:main`; a `&` before `<` stays a command separator. Push options with a separate value (`-o`, `--push-option`, `--repo`, `--receive-pack`, `--exec`) no longer name the remote, and `--repo` is the remote when no operand names one. A `git push` without a refspec is checked where git would push it (`@{push}`), so a branch whose upstream is the base can't land on it unreviewed under `push.default=upstream`, whatever the fetch refspec calls the remote branch (the remote and branch come from the branch's config). `&>` counts as a redirection with no space before it, and `git push --branches` is read like `--all`.
- **Folders: the guard follows plain moves and asks or refuses on the rest.** A plain `cd`, `pushd` or `popd` (the command's first word, one literal folder, `-L`/`-P`, `--`, `cd -`, `~-`, not in a pipeline, after `||` or in the background, in a command with no comment, unquoted substitution, brace group, `|&`, heredoc or `case`, not in a list sent to the background; after `&&` only while the chain lasts; after `-P` the real folder) is followed in the review gate; any other move, a nested subshell or a parenthesis the tokens can't tell from text makes the folder unknown, so the landing fails closed, and a landing inside `( … )` ends the subshell too. The protection of the review records checks every folder a move in the command may reach (with `$HOME`, `$TMPDIR` and macOS's `${TMPDIR}eng-kit/…`), asks before any write after a move it doesn't follow exactly (a write into the records still blocks), and counts `>& file`, `&>`, `>|`, a redirection on a move, a substitution in a read-only command and git's `--output` as writes, checking a path after `=` and the words of a quoted substitution too; a `>` counts wherever it stands, since the guard can't pair quotes as the shell does (heredoc bodies, comments).
- **Headless runs refuse the unusual moves.** A question is a refusal without a UI (`claude -p`, a pi run without one), so a command whose move the guard doesn't follow, such as `cd "$(git rev-parse --show-toplevel)" && npm test` or `cd $X && npm test`, is refused there where 0.21.0 ran it. Write the move as a plain `cd <folder>`.
- **The command guard** blocks the abbreviations git accepts for `--no-verify` (`--no-veri`, `--no-verif`), and reads `&>`, `&>>`, `2>&1` and `>|` as redirections, so `declare &>/dev/null -x GIT_DIR=…` asks like `declare -x GIT_DIR=…`; an escaped `\>` before `&` is a word, so that `&` still separates commands.
- **The reviewer** sets earlier reports aside only after `git merge-base --is-ancestor {BASE} {REMOTE_BASE}` confirms that the range starts on the remote base; otherwise it says Inconclusive.
- **test-hygiene v5:** a one-argument Vitest `context.skip("platform: …")` keeps its reason. Re-run kit-init with `--test-hygiene` to replace an older copy.
- Docs: `git-workflow`'s `--ff-only` step, the `/finish` summaries (a PR by default after a Yes), the README guard table on PR/MR merges, and an `allow` pattern also quieting the `implementer`'s push.

## 0.21.0

- **Load a skill before naming it.** In the eval traces the agent announced "Using test-driven-development" without loading the skill and worked from memory: it took a missing-module error as the failing test, which test-driven-development rules out. `using-skills` now says to load the skill first, then announce it, and that naming a skill without loading it doesn't count. In `tdd-discount` the skill loaded in 5 of 6 runs with this wording, against 0 of 5 before (small samples; `docs/EVALS.md`). `verify-before-done` still loads no skill; a likely reason is that its skill is needed at the end of the task, which a Stop-hook reminder will test.
- **The session context names the command form** the user types for kit commands: `/eng-kit:<name>` as a plugin, `/<name>` in a project install. It replaces a line in `using-skills`, which made room for the new rule within the skill's word budget; the tool lines there are also shorter.

## 0.20.0

- **Evals: what the kit changes, measured.** `evals/` holds six tasks that `claude plugin eval` runs with the kit and with no plugin (TDD on a spec, bug root cause, no test weakening under pressure, secrets stay out, verify before done, money in minor units), each a small git fixture with graders on the result and on the steps. `npm run eval` runs the suite; results stay out of git; the folder install doesn't copy it.
- **First results** (`docs/EVALS.md`): mean Δ +0.11 with Sonnet. With the kit the agent's bug fixes validate the whole input more often (+0.33), and the agent keeps out of `.env` (+0.17) and writes the test before the code (+0.13); order graders that see one tool per side make the first and last figures approximate; on the other three tasks the model already scores 1.0 without it. A run with the kit costs about 60 % more and takes about 50 % longer.
- `writing-skills`: a change to a skill the suite covers is checked with `npm run eval -- --case <name>`.

## 0.19.0

- **Feature flags and experiments.** New `backend-services/references/feature-flags.md`: the code talks to flags through OpenFeature and the provider is a stack choice; a typed registry in the repo with a safe default and owner per flag, and a removal date for release and experiment flags; evaluation never throws (in process from a synced rule set, the last good set when the sync fails, the defaults when none was loaded or a flag can't be evaluated); a closed context without personal data; deterministic bucketing pinned by a test; server-side evaluation handed to the client; audited changes; exposure-based experiments with a sample-ratio check; tests for both branches and the defaults. The TS profile gets a Flags row, and the reviewer checklist a line for new flags.
- **API contracts.** New `backend-services/references/api-contracts.md`: an internal typed RPC is a contract for the open tabs still running the old client (deprecate, then remove a release later), machine-readable error codes, resource checks after input validation with a cross-tenant test.
- **Server cache.** `state-and-data.md` gets a section: one place for freshness and retry, no retry on 4xx except 408 and 429 (backoff, `Retry-After`), keys from one shared query-options function, invalidate after every mutation, a query client per server-rendered request, one error path, dev tools in development only.
- **Test helpers.** `test-standard.md`: cleanup reports every failure together, setup checks that the database is migrated and seeded, provider fakes are chosen by configuration and refused at startup in production, several implementations of one contract share a parametrized suite, personas live in one module with a seed check.
- **Writing subagents.** `writing-skills` now covers agents: when an agent beats a skill, the file format, prompt rules (one responsibility, least privilege, model by stakes, self-contained input, a fixed report) and how to test one, in `references/agents.md`.
- **Make it stick.** `receiving-code-review`: a finding or correction that will recur becomes a proposed check or rule, the strongest level first (a mechanical check, a project rule, a kit change through writing-skills); the user decides, and open proposals join the task's Follow-ups.

## 0.18.2

- **`export` options end at the first name.** `export GIT_DIR=/x -n` and `export -- -n GIT_DIR=/x` export `GIT_DIR` in bash, so they ask now; only an `-n` before the first name or `--` un-exports. A lone `-` ends the options too (`export - -n GIT_DIR=/x` asks). The same rule applies to `declare -x` and `typeset -x`, which also take `+` options (`declare +i -x GIT_DIR=/x` asks) and end their options only at `--`, a lone `-` or `+`, or an assignment (`declare 2>err -x GIT_DIR=/x` asks), so `declare GIT_DIR=x -x` (which does not export) stays quiet.
- **The `db.mjs` test ignores an inherited `POSTGRES_MAJOR`.** It runs with a decoy value in the environment, so it passes only when the script passes the version from `.postgres-version`.

## 0.18.1

- **Template `db.mjs` rejects inherited names.** `node scripts/db.mjs constructor` (or `toString`) now prints the usage line and exits non-zero instead of throwing; the action is checked with `Object.hasOwn`.
- **`export -n NAME` stays quiet.** Un-exporting a variable no longer asks, whatever the name.
- **Behaviour test for `db.mjs`.** The text-matching contract test is replaced by a run against a stub `docker`: `up` and `down` arguments, `POSTGRES_MAJOR` from `.postgres-version`, and exit 1 for a bad version file. Skipped on Windows (POSIX stub).
- **Docs.** The scaffold script tests are described as covering `.postgres-version` and argument parsing.

## 0.18.0

- **Git variables that run a program or redirect git ask.** Set in front of a git call (`X=… git …`, `env X=… git …`) or exported in the same command (an `export NAME` by name asks too, also `declare -x` and `typeset -x`, after `{`, `then` and the like): the program-running group (`GIT_SSH_COMMAND`, `GIT_SSH`, `GIT_PROXY_COMMAND`, `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_EXTERNAL_DIFF`, `GIT_PAGER`, `GIT_EDITOR`, `GIT_SEQUENCE_EDITOR`, and `PAGER`, `EDITOR`, `VISUAL` in front of a git call), the config-injection group (`GIT_CONFIG`, `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_<n>`, `GIT_CONFIG_VALUE_<n>`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_GLOBAL`, `GIT_CONFIG_SYSTEM`) and the redirecting group (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_EXEC_PATH`, `GIT_NAMESPACE`, `GIT_TEMPLATE_DIR`). A harmless pager, editor or askpass value (empty, `cat`, `true`, `:`) and other variables stay quiet.
- **The residual list changes.** "Environment forms of command keys" is gone; what remains is a variable exported in an earlier command (the hook's own environment is still checked for pushes), a variable placed before a program that runs git itself (`gh`, `npm install` with git dependencies, `make`, scripts), a variable already exported by the user's shell profile, proxy variables (`HTTPS_PROXY`, `ALL_PROXY`), `GIT_ALLOW_PROTOCOL` and `export EDITOR=…` (by design), along with obfuscated strings, renamed or relative git binaries, interpreter one-liners, unlisted shells and wrappers, script files, writes into `.git/` and a `gh api` method set by a header override.
- **The template pins Postgres once.** `scaffold-template.ts <absolute dir> --postgres <major>` writes `.postgres-version`, the single source like `.nvmrc`, and refuses without a positive integer (check the current supported major at postgresql.org). `pnpm db:up` and `pnpm db:down` run `node scripts/db.mjs up|down` (no shell, so it works on Windows too) to start and stop the local database from it, the healthcheck waits for TCP, and `POSTGRES_MAJOR` is no longer set by hand. The scaffold accepts `--postgres <n>` or `--postgres=<n>` and refuses unknown options.
- **A `db` job in the template's CI.** It starts Postgres with `pnpm db:up`, deploys, reverts the latest migration, checks that the schema is empty, deploys again and checks that it matches `schema.prisma`; it is in the gate's `needs`, and the workflow holds no Postgres version. The kit's `template-smoke` scaffolds with `--postgres 18` and starts the database the same way.
- Upgrade: existing scaffolded projects are unaffected; a new scaffold needs `--postgres <major>`. Left for later: a per-package CI matrix when a job gets slow.

## 0.17.0

- **More ordinary paths now ask.** `gh api` and `glab api` writes (a non-GET method, field or input flags without a method, GraphQL mutations, and GraphQL queries taken from `$VAR`, `$(…)`, a `@file` or `--input`; an inline read query stays quiet), `git svn dcommit|branch|tag|set-tree`, `git p4 submit|commit`, `prisma db execute`, `prisma migrate resolve`, and `migrate:down` / `migrate rollback` runs. `doas`, `run0` and `pkexec` ask as root, like `sudo`.
- **Config keys that run commands ask,** persistent (`git config`) and one-off (`-c`): `core.pager`, `core.editor`, `core.askpass`, `core.hooksPath`, `core.sshCommand`, `core.fsmonitor`, `core.gitProxy`, `sequence.editor`, `diff.external`, `gpg.program`, `filter.*`, `pager.*`, diff and merge drivers, difftool and mergetool commands, `submodule.*.update`, credential helpers and `http.proxy`. A harmless `-c` value (empty, `cat`, `true`, `:`) stays quiet for the program-running keys only (pager, editor, askpass, `sequence.editor`, `diff.external`, `gpg.program`, `filter.*`, `pager.*`, drivers, tool commands, `submodule.*.update`); `core.hooksPath`, `core.sshCommand`, `core.fsmonitor`, `core.gitProxy`, `http.proxy` and credential helpers always ask. A one-operand `git config <key>` read stays quiet.
- **The guard sees more.** `--no-verify` is blocked inside groups and substitutions; setup commands and quote-split pushes behind `stdbuf`, `flock`, `ionice`, `taskset`, `chrt`, `setsid`, `unbuffer` and `doas` ask.
- **A shorter residual list.** What stays outside a command guard: obfuscated strings, renamed or relative git binaries (`bin/git`), interpreter one-liners, shells it doesn't list, script files, a setup command behind a wrapper the guard doesn't list (`find -exec`, `caffeinate`, `watch`), writes into `.git/`, environment forms such as `GIT_PAGER`, `GIT_EDITOR` and `GIT_SSH_COMMAND`, and a `gh api` method set by a header override.
- **kit-init reads Turbo CI.** A Turbo verify command counts as covered when a CI step runs `turbo run` with all its tasks, in any order and with harmless flags (`--affected` and other output or performance flags); `--filter`, `-F` and `--dry-run` don't cover.
- **Reversible template migrations.** Every `ts-monorepo` migration ships a `down.sql`. `migrate:down <name>` reverts the latest applied migration in one transaction and marks its history row rolled back; `migrate deploy` applies it again. Run it only after the code was rolled back. `template-smoke` checks deploy, revert to an empty schema and deploy again. The TypeScript full-stack profile's Migrations row says the same, replacing the advice to correct the history by hand.
- **Smaller notes.** The template's `pr.yml` points at a per-package CI matrix for when a job gets slow. The own-branch push of the `implementer` subagent asks (it hands its commit back), and the finish docs say a PR is opened by default after a `Yes`, while merging, keeping and discarding wait for the user.
- **Tests.** Duplicated and split tests are merged or removed, one stale assertion is fixed, and the hook tests no longer read the machine's global git config. No rule lost coverage.
- Upgrade: nothing to migrate. Left for later: a database job in the template's own `pr.yml`, environment forms of command keys, a per-package CI matrix when needed.

## 0.16.0

- **The agent pushes its own work branch.** A plain `git push` of the current branch no longer asks when the command is exactly `git [-C path] push [-u|--set-upstream|-q|-v|--progress|--no-progress|-n|--dry-run|--porcelain] [remote [refspec]]` with no shell operators, quotes or variables; the branch is named by the convention `<type>/<kebab>` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `style`, `revert`) and is not the base; the remote is configured and its effective push URL equals its configured URL; the push config adds nothing (no mirror, push refspecs, `followTags`, `pushOption`, `recurseSubmodules`, `receivepack`, unusual `push.default`); no `GIT_*` redirect variable is set; the refspec names only the current branch; and the repository is the session's project (same git common directory, worktrees count). Everything else that pushes still asks, `--force`, `-f`, `+ref` and `--mirror` stay blocked, and `--force-with-lease` asks.
- **The review gate is unchanged, merges always ask.** `gh pr create` / `glab mr create` and pushes to a PR branch the agent opened need a `Yes` covering HEAD. PR/MR merges (`gh pr merge`, `glab mr merge`) always ask, with or without a `Yes`, and so do pushes to the base; the old "name the branch, or merge from it" advice is gone.
- **New questions.** Things that can point a push elsewhere: `git remote add|set-url|rename|set-head`, `git config` writes to `remote.`, `url.`, `push.`, `branch.`, `alias.`, `include.` and `includeif.`, `git config -e`, `--config-env`, or `-c` with a key that moves where git pushes or what it runs (`remote.`, `url.`, `push.`, `branch.`, `alias.`, `include.`, `core.sshCommand`, `core.hooksPath`, `credential.helper` and similar), `git symbolic-ref` writes, `git update-ref --stdin` or on `refs/remotes`, unknown git options before the subcommand, indirect git (`xargs git`, wrappers; a dashed `git-<sub>` is treated as `git <sub>`) and `sh -c`, `bash -c` or `eval` strings that contain git. Everyday reads stay quiet (`git --version`, read-only git in substitutions, `git -c` with ordinary keys, `git symbolic-ref` reads), and a trailing `2>&1` is allowed on the push. The `implementer` subagent's own-branch push asks.
- **Finishing pushes and opens the PR.** After a reviewer `Yes` on HEAD, `/finish` and git-workflow push the work branch and open the PR by default; merging locally, keeping and discarding wait for the user's choice, and the agent never merges without the user.
- **Skills say the same.** git-workflow: push the work branch and open the PR yourself once the review covers HEAD; merging, pushing to the base and rewriting pushed history stay the user's choice. using-skills lists merging and pushing the base, not a push, as outward-facing.
- **Residual, stated in the docs.** A command guard can't see everything: quote-obfuscated shell strings, interpreter one-liners, shells it doesn't list (`fish -c`), sourced scripts and script files, git under another name (a symlink or a copied binary) or through a relative path (`bin/git`), a setup command behind a wrapper the guard doesn't list (`stdbuf`, `flock`, `find -exec`), commands run through git config values (`-c core.pager=…`, `core.editor`, `diff.external`, `gpg.program`, `filter.*`), and shell writes into `.git/config` or `.git/refs` can configure a remote or push. Like `curl`, exfiltration is not something the guard prevents; server-side CI, review and branch protection carry the rest.
- Upgrade: the first push of a convention-named work branch no longer asks. A project with another branch convention adds an `allow` pattern to `guard.json`, for example `^git push( -u)? origin (story|task)/[a-z0-9._-]+$`. The `templates/guard.json` example is anchored (`^git push( -u)? origin (story|task)/[a-z0-9._-]+$`): `allow` skips all of the guard's questions for the matching command, so keep patterns anchored. Nothing to migrate.

## 0.15.0

- **A TypeScript full-stack profile as one candidate.** `choosing-a-stack/references/ts-fullstack-profile.md` covers a new TypeScript web product or SaaS with one team and Postgres. Per role it gives a choice, the reason, when not to take it and an alternative, names no versions, and lists the known weaknesses of that stack as warnings. It is offered next to other candidates, never as the default, and 0.x is allowed in a key role only as a named exception with its reason in the decision record.
- **A `ts-monorepo` template and a scaffold script.** `templates/ts-monorepo/` is a working skeleton: pnpm workspaces and Turbo, a React + Vite web app, an Express 5 API, Prisma with Kysely queries, shared TypeScript, ESLint and Prettier presets (the client boundary is a lint rule), Postgres-only compose, a manifest and a PR workflow. It holds no versions. `node scripts/scaffold-template.ts <dir>` refuses a non-empty folder, copies the template, writes `.nvmrc` and `packageManager` from the running Node and pnpm, and installs every package at its highest stable release that is at least a day old, capped at the major of a stable `latest` tag and pinned exactly; `@types/node` follows the Node major and workspace packages are `workspace:*`.
- **Four practices in their skills, with no stack attached.** ci-quality-gates: monorepo CI that runs only what a change affects, falls back to everything, writes the cache only from main and ends in one gate. backend-services: one store until measured (the existing database carries the queue, cache, rate-limit counters and locks until a measurement shows a separate service is needed; database-changes already requires statement and lock timeouts on every connection). web-frontend: a client/server boundary enforced by lint, build and a bundle check. updating-dependencies: every override and patch has a reason and a removal condition, a release-age delay, no `@latest` in tool configs, one source of the runtime version.
- **kit-init detects Turbo monorepos.** With `turbo.json` (or `turbo.jsonc`, comments allowed) it builds one `<exec> turbo run typecheck lint test` from the tasks the file declares; `pkg#task` declares `task`, and `<exec>` is `pnpm`, `yarn`, `bunx --no-install` or `npx --no` by lockfile, so only a locally installed turbo runs. A manifest's Commands still win, and an unreadable `turbo.json` or one with none of those tasks falls through to the `package.json` scripts.
- **`template-smoke`** runs in the kit's own CI weekly and on PRs that touch the template or the script. It scaffolds the template, runs `pnpm turbo run typecheck lint test` and `prisma migrate deploy` against Postgres. It is outside `gate` and the release.
- `pnpm-workspace.yaml` alone now selects pnpm in kit-init, without a lockfile.
- Upgrade: nothing to migrate. Existing `verify.json` files are kept.

## 0.14.0

- **The review gate covers the whole branch.** The reviewer ends with three lines: `Reviewed BASE:`, `Reviewed HEAD:` and `Ready to merge:`. A `Yes` counts only when its range reaches the remote base (`origin/<base>`, or the local base without a remote), directly or through earlier rounds whose own ranges do, up to 20 rounds. A review of only the last commit, an empty range and a chain broken by a rebase cover nothing. **Records written by 0.13.0 have no range: after updating, review each branch once more.**
- **Earlier findings come from the store.** The hook keeps each reviewer's report with its verdict, and `scripts/review-log.ts <rev>` prints a commit's latest round. A repeat round's reviewer runs it itself, so the author no longer passes the findings on.
- **A PR the agent opened is a landing.** After a successful `gh pr create` or `glab mr create`, a push to that branch needs the same review. The branch is forgotten once the PR's head is on the base, or after 30 days. PRs opened elsewhere are not seen.
- **The reviewer only reads.** In the reviewer subagent the guard allows only git's read-only subcommands (without `-c`, `--output`, `--ext-diff`), `cat`/`head`/`tail`/`grep`/`wc`/`ls`, `git worktree add/remove` at an absolute temp path, the project's verification commands and the kit's review-log. It fails closed on anything its parser might misread (`\`, `$`, backticks, parentheses, braces, `<`, other redirections, `&`, an unfollowable `cd`) and on PowerShell.
- **A throwing guard asks.** An error while handling PreToolUse answers `ask` with the error instead of exiting 1, which let the call through. A hook that can't start or times out still lets the call through (documented).
- The reviewer reads the project's rules at the merge-base with the remote base (`{RULES_BASE}`) in every round; it starts by running review-log on `{BASE}` and re-checks the reports in a repeat round. A parallel security-focused reviewer is required for money, auth, permissions, secrets, schema, CI and release or deploy config.
- Review records are keyed by the repository's git common directory, so the hook, review-log in a subfolder or worktree, and a symlinked checkout all find them.
- A repeat round can't skip a newer reviewed commit, and the chain check is memoized and budgeted (300 git calls), so it can't stall the hook.
- A push to a remote that doesn't track the base still anchors the chain on the remote base (`origin`'s), not the local branch.
- The guard's parser honours backslash escapes and `$'…'`: `echo \' ; <command> ; echo \'` no longer hides the command. A backslash line continuation joins the command. `rg --pre` is no longer a safe step before a landing. The reviewer's shell also refuses globs, which could expand into a planted `--output=…` file name.
- A PR's branch is the one where `gh pr create` started (`--head owner:branch` gives `branch`), registered when the call succeeds, or fails after the PR step.

## 0.13.0

- One source for the test rules. test-driven-development's `references/test-standard.md` now holds every test rule. TDD, BDD, writing-plans, the review checklist and the other skills link to it instead of restating it, and the wording that contradicted itself is gone:
  - the plan template's expected RED is an assertion failure after a stub, never "not defined";
  - a manual check verifies a criterion only where automation is impossible (hardware, a store review, a fiscal device, a signature), with the reason in the task file and the user's agreement;
  - with BDD a user-visible criterion has exactly one scenario; every other criterion has at least one test at the cheapest level; end-to-end without BDD covers critical flows only;
  - **outside-in TDD with BDD:** the scenario is written first and seen failing, unit cycles drive the code, and the scenario passing closes the criterion. Unit tests test their unit's own contract and stay; only a unit test asserting the user-level outcome the scenario proves is left out;
  - characterization tests are `*.char.test.*` and pass on first run by design; golden data in a port is an acceptance test that fails first; every other new test is seen failing first;
  - deleting a test together with its behavior, or one that never protected anything, needs only the reason in the commit; every other edit, deletion or skip needs the user's agreement, and a skip names a linked issue (a reason in words is not enough), except a platform or test-mode skip whose reason starts with `platform:` or `mode:`;
  - provider-sandbox tests are a separate suite and CI job;
  - tests never retry; waits are on a condition with one ceiling, never a fixed sleep;
  - missing test infrastructure fails the run instead of skipping;
  - flake fixes meet five criteria;
  - isolation rules for parallel tests, uncached state-dependent tests, test data kept out of production builds, CI-only visual baselines, small inline snapshots.
- Criterion tags are checked in review against the task file (the checklist's Tests section); finished tasks' tags stay as history.
- The review checklist adds fixed severities:
  - Critical: a focused test committed; a CI check removed, skipped or retried, or retries in a runner config;
  - Important: a manual check that isn't agreed or isn't necessary; a Review focus line without a test; a test without an assertion or asserting mock echo; an expected value copied from or recomputed like the code; a test-only helper in production code; a fixed sleep or real network call outside the sandbox suite; payments without a sandbox test; POS without a list of what ran on real hardware.
- **Test hygiene on any stack.** A new dependency-free `scripts/test-hygiene.ts`, run with Node ≥22.18, checks:
  - focused tests, and skips without a linked issue (JS/TS including Playwright and Cypress, Python, JVM, Go, Swift, .NET, Gherkin);
  - fixed sleeps;
  - retries in runner configs and test code;
  - with `--junit`, only the reports: missing, empty, or counts that don't add up (a crashed shard);

  In an existing project it checks only the lines a change adds (renames followed); old debt is counted, not blocking. Without a merge base it stops with a message. `test-hygiene: allow <reason>` marks a line where the pattern is the behavior under test; hiding a forbidden skip, retry or sleep with it needs the user's agreement. ci-quality-gates gets `test-hygiene` and `e2e` CI jobs and a per-stack table of native linters and JUnit reporters.
- **Review gate: a verdict covers exactly the commit reviewed.** Any change after it needs a new review: a new commit, an amend, a rebase onto a newer base, a docs edit, deleting the task file. Documentation-only branches are reviewed too, and only commits already on the push remote's base branch land nothing new. The change identity and the exempt list are gone. executing-plans' Finish and `/finish` run the final review last, after docs, the task-file removal and any rebase, and a fix pushed to an open PR needs a new review.
- A review counts only for verified code: one recorded while edits were unverified is Inconclusive.
- The PR body says how each new test was seen failing first; executing-plans' completion contract includes it.
- kit-init offers the script as `.ci/test-hygiene.mts` (an ES module whatever `package.json` says) and copies it only with `--test-hygiene`. It reports an older copy, and a CI that doesn't run it. Project installs copy the script too.

## 0.12.0

- Review gate. The guard denies `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to the base unless the kit reviewer's last verdict is `Yes` for the commit being landed.
  - A new `SubagentStop` hook records the verdict of the kit's `reviewer` (`eng-kit:reviewer`) from its own last message (`Reviewed HEAD: <sha>` and `Ready to merge: …`), one record per reviewer run; the main agent never writes it. A report without those lines sends the reviewer back once. Parallel reviewers from one prompt combine to the worst verdict.
  - A review covers the branch's own change to reviewable files, compared with the remote base. Deleting task files, changing docs or other markdown, and rebasing onto a newer base keep it valid; any other change needs a new review. Markdown that steers the agent (CLAUDE.md, AGENTS.md, SKILL.md, `.claude/`, `rules/`, `skills/`, `agents/`, `prompts/`) is reviewable. The list is fixed.
  - Worktrees: `cd <dir>` and `git -C <dir>` are followed. A landing chained after anything but read-only steps is denied; `gh pr merge <number>` asks.
  - A change is identified by its diff with one line of context but without line numbers (and binaries by content), so whitespace, moved lines and binary changes need a new review while a rebase keeps it. Code under `docs/` (a docs site's config) is reviewable; prose and pictures there are not. A `cd` the guard can't follow (a variable, `$(…)`, a nested subshell, a missing folder; a `cd` inside one `( … )` is followed and ends with it) and `-R` to another repository fail closed. `git push origin HEAD` from the base branch counts as a landing. `gh pr merge` checks the remote branch as well. A reviewer run that gives no verdict twice counts as Inconclusive for the commit it reviewed. A landing may follow read-only steps and the project's verification commands in one command.
  - `.claude/guard.json` gets `reviewGate` (`false` turns it off). The guard asks before `.claude/guard.json` is changed (Edit/Write or shell) and denies writes to the review records.
- The reviewer's output ends with `Reviewed HEAD:` and adds the verdict `Inconclusive` for a review that could not read the requirements, the range or the rules. A finding against a project rule cites the rule. The reviewer doesn't repeat what the verification commands and linters check, gives wordy prose at most one grouped Minor, and matches repeat-round findings by the underlying defect.
- Parallel reviewers merge by root cause; the same `file:line` keeps the higher severity. executing-plans and `/finish` re-review after fixes until `Yes`. receiving-code-review doesn't call a finding resolved before a re-review closed it.
- ci-quality-gates offers one required human approval and a CODEOWNERS file for the files that steer every change (template in `references/ci-templates.md`), both only on the user's yes.

## 0.11.0

- One task file replaces the roadmap, spec, plan and ledger. Each piece of work gets `docs/tasks/YYYY-MM-DD-<slug>.md` from `templates/task.md`, which stands in for a tracker issue: the user's request verbatim, the description (Intent, Context, Success criteria, Scope, Decisions, Design, Rollout, Risks), Follow-ups, Plan and Progress. `templates/spec.md` is gone.
  - Two approvals in one file: brainstorming writes the description (`Status: design approved`), then writing-plans fills `## Plan` (`Status: plan approved`). The approval gate reminds to commit either one.
  - executing-plans records baseline, drift, rulings and completed tasks in `## Progress`; only `## Plan` has checkboxes.
  - `/new-task` writes the same file with only the description; `tasks/<NN>-<slug>.md` is gone.
- No roadmap. Several independent subsystems become separate tasks: one now, the others one line each in its Follow-ups, each later with its own task file, branch and PR. When a task finishes, its Follow-ups go to the user and the file is deleted. Big coherent work is not cut to fit a size.
- The rules for task files are the same as for the old working documents: they live only on the work branch. The guard, the Stop gate and the `working-docs` CI job now watch `docs/tasks/` (the `workDocs` default is `["docs/tasks"]`). A task file counts as implemented when every checkbox in its Plan section is ticked.

## 0.10.0

- New skill `ui-motion` for web, Android, iOS and desktop. It decides first whether something should move at all: frequent and keyboard-triggered actions get no motion except press feedback, and every animation needs a named purpose. Then it covers easing by movement type (no ease-in on UI), budgets under 300 ms, physical origin, interruptibility, cheap properties only, reduced motion as "gentler, not zero", and gesture physics (velocity handoff, momentum projection, rubber-banding). It includes review and audit procedures. `references/` holds the exact values and formulas and the per-platform APIs.
- web-frontend gets two references. `state-and-data.md` covers where state lives, optimistic updates (a rollback is never silent, money is never optimistic), real content instead of placeholders, and explicit time zones. `design-system.md` covers tokens and the rule of three, closed component variants, design context in `design.md`, system fonts on operational UIs, and honest copy for destructive actions. Bundle budgets are measured on the built artifact; profiling comes before memoizing.
- mobile-development adds touch and feel: respond on touch-down, touch targets of 44 pt / 48 dp, safe areas and insets. desktop-development adds the system animation setting and hover only with a precise pointer.
- The review checklist gains severities for optimistic payments, silent rollbacks and motion defects. ci-quality-gates adds a bundle and size budget layer, and turns a review comment repeated a third time into a lint rule. BDD waits get a project-wide ceiling. Onboarding maps the design system, and the manifest template points UI work at `design.md`.
- NOTICE.md credits Emil Kowalski's skills (MIT), which the motion rules adapt.

## 0.9.0

- Working documents never reach the base branch. Specs, plans and their ledgers live only on the work branch; at the end of the work, what lasts moves into the topic chapter and `docs/decisions/`, and they are deleted in one commit. A roadmap stays on the base branch only while it has open pieces.
  - Guard denies `gh pr create/merge`, `glab mr create/merge`, `git merge` into the base and `git push` to the base while working documents are tracked, and denies committing them on the base branch. `.claude/guard.json` gets a `workDocs` key (default `["docs/specs", "docs/plans"]`, `[]` turns the rule off).
  - New Stop gate: a plan with every checkbox ticked, or a roadmap with no open piece, sends Claude back once per prompt to move what lasts and delete it.
  - The approval gate counts only `Status: approved`; on the base branch it asks for a work branch first. The statuses `done`, `implemented` and `superseded` are gone.
  - The ci-quality-gates templates add a `working-docs` job; kit-init reports CI that lacks it.
- Decision records are living: one topic per `docs/decisions/NNNN-slug.md`, rewritten in place or deleted, with sections Decision, Why, Consequences, Considered and rejected. `/docs decision <topic>` replaces `/docs adr`.
- Roadmaps split work only at seams: each piece delivers value or a rollout step and is green on its own; a coherent change is never cut to fit a size.
- The CLAUDE.md template has a Docs section: the index, a task map, which source wins, and the working-docs rule. Its guidance lines are HTML comments, which Claude Code strips from context. Onboarding puts area rules into `.claude/rules/*.md` with `paths:`.
- The reviewer checks the project's own rules (manifest, path rules, decision records); breaking one is Important. The context map treats tickets, old plans and docs as hypotheses to check against the code.

## 0.8.0

- Risk sets the floor of the process: `using-skills` now says a change to CI or release pipelines, permissions, auth, secrets handling, money, database schema or deploy configuration is never Bounded, however small. Two new red flags: "It's small, so it's Bounded" and "They answered my question, so the design is approved".
- Guard asks before any write or edit of a CI or release pipeline file: `.github/workflows/`, `.github/actions/`, `.gitlab-ci.yml`, `.gitlab/ci/`, `.circleci/`, `.buildkite/`, `azure-pipelines.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`. Reading them is unchanged.

## 0.7.1

- English versions of the docs in `docs/`. English is now the primary version; the Russian originals stay as `*.ru.md`, and each file links to its counterpart.

## 0.7.0

- New skill `ci-quality-gates`:
  - CI runs at least every verification command, behind one required `gate` job;
  - layers added per stack with approval: test hygiene, end-to-end with retries off and a test-count check, secret scanning and dependency audit, migrations and schema drift, contract regeneration, doc links, commit lint, and coverage as a scheduled floor;
  - pinned actions, no weakened checks, and branch protection only with approval;
  - `references/ci-templates.md` holds GitHub Actions and GitLab CI templates and a tool table by stack.
- `kit-init` checks mechanically whether the project's CI runs every verification command, and reports it as missing or stale.
- Optional BDD layer (`test-driven-development/references/bdd.md`): one scenario per user-visible criterion, tagged with it; Given through the fast path; stable selectors; independent scenarios; CI-made visual baselines; retries off.
- The review checklist flags a verification command missing from CI and a weakened CI check. `git-workflow` counts every check in the gate.

## 0.6.0

- New platform skill `backend-services`, covering the 12-factor rules that no other skill holds:
  - one config module validated at startup, and secrets only at runtime;
  - one artifact promoted through every environment, with the version reported;
  - stateless processes and separate process types;
  - backing services attached through configuration;
  - liveness versus readiness, and draining on SIGTERM;
  - dev/prod parity;
  - logs to stdout, and one-off tasks run from the release;
  - API contracts as the source of truth.
- New review severities: a secret in a build argument, image or client bundle is Critical. Environment access outside the config module, missing startup validation and exiting without draining are Important. Onboarding maps the configuration.

## 0.5.0

- New skill `observability`:
  - logs: level policy, fixed messages with values in fields, no personal or payment data even masked, and each error logged once where it is handled;
  - request and trace ids propagated through HTTP, queues and jobs;
  - RED/USE metrics with bounded labels;
  - a configured deadline on every wait;
  - alerts with runbooks, including one on lost telemetry;
  - bounded, read-only log queries when investigating.

  `references/metrics-and-alerts.md` holds naming, cardinality budgets, alert templates and query recipes.
- New skill `database-changes`:
  - migrations that work with the old and the new code (expand/contract), are reversible and take short locks, with backfills as separate jobs;
  - deploy order and a drift check;
  - transactions with an outbox, and query guardrails;
  - data lifecycle: archive, purge, retention;
  - device databases.

  `references/migration-patterns.md` holds expand/contract recipes, lock notes and a backfill template.
- The review checklist gets new fixed severities for personal data in logs, destructive migrations, missing deadlines and unbounded metric labels. Debugging starts with telemetry for problems outside your machine.

## 0.4.0

- Stricter review:
  - fixed severities: secrets, placeholder code, suppressed type or lint errors and weakened tests are Critical; a criterion without a test, stale docs, an unmarked breaking change and oversized new functions or files are Important;
  - severities don't drop for "the repo does this everywhere" or because the author argues;
  - changes to the rules themselves are judged against the base branch;
  - repeat review rounds cover only the new commits and re-check every open finding;
  - no praise, and no invented links.
- `receiving-code-review`: every comment ends fixed or answered, and nothing is called resolved while a blocker is open.
- `git-workflow`:
  - fetch before branching, and don't work on a branch that is already merged;
  - follow the project's commit linter, and order split commits so each one is green;
  - a new section, "After a push": follow CI with the host's tool, make at most two fix attempts per failing check, never merge, and rebase with `--force-with-lease=<branch>:<sha>`.
  - `finish` offers to follow CI.
- New skill `updating-dependencies`: one dependency at a time, the changelog read, majors and new dependencies only with approval, security first, the lockfile changed only by the package manager, and platform constraints for mobile and POS.
- `verification-before-completion`: long-running processes run in the background; stop only the ones you started.

## 0.3.1

- Approval gate: if a spec or plan in `docs/specs` or `docs/plans` has the status approved, implemented, superseded or done but isn't committed, the agent can't finish its turn until it commits the file. The reminder comes once per prompt; drafts and plans in progress don't count. `writing-plans` commits the plan on approval.

## 0.3.0

- Spec skeleton `templates/spec.md`: Intent, Context, Success criteria (criterion + how verified), Scope in/out, Decisions, Design, Rollout, Risks and open questions. Headings are exact, each section answers one question, and `None` replaces a deleted section. A spec over about 300 lines or 10 criteria is split through the roadmap.
- `brainstorming` builds a context map before asking anything (`references/context-map.md`), then states the intent, up to five assumptions and the open questions. Roadmap pieces are sized to one concern, one plan and one reviewable PR.
- Plans record `Base:` (the commit SHA they were written against), and `executing-plans` checks for drift before starting.
- `git-workflow` gains a PR description format and suggests splitting oversized PRs.

## 0.2.9

- Testing standard (`test-driven-development/references/test-standard.md`), covering:
  - expected values from requirements, never from the code's output; characterization tests marked as such;
  - which tests are worth writing, AAA structure and names;
  - test doubles only for unmanaged dependencies, with your own database real;
  - determinism, and flakes fixed at their cause (no retries);
  - an acceptance test for each criterion;
  - coverage as a floor, not a target;
  - test lint rules to propose.
- Plans name each criterion's acceptance test, and the review checklist checks the new rules.

## 0.2.8

- New entry point `/docs`: an inventory and documentation map (README, `docs/NN-topic.md` chapters with a `docs/README.md` index, CHANGELOG), then writing the approved documents from the code and the implemented specs. `/docs <topic>` writes one chapter, `/docs changelog` writes changelog entries from git, and `/docs adr <decision>` writes a decision record.
- `writing-documentation` separates working documents (specs, plans, ledgers) from system documents, and adds a topic chapter template. An implemented spec moves what lasts into its chapter and links to it.
- A plan's Post-implementation block names the feature's topic chapter, and onboarding offers `/docs` when a repo has no README or docs index.

## 0.2.7

- Docs are kept current on every change, not only at review. Plans carry a `Post-implementation` block listing the docs a change makes stale; `implement` and `executing-plans` update them in the same branch; the final report has a **Docs** line; reviewers rate stale docs as Important. `writing-documentation/references/checks.md` lists mechanical checks to propose for the project's verification and CI.

## 0.2.6

- Verify gate: a run of the verify script counts even when its output is piped (the script records its own result); background runs don't count when they start.
- Verify gate: edits outside the project (plans, memory, scratch files) and documentation edits no longer make the workspace unverified. `verify.json` gets an `ignore` list of globs (default: `**/*.md`, `**/*.mdx`, `**/*.txt`, `docs/**`); `"ignore": []` restores the strict behavior.
- The gate's message lists the files changed since the last green run.

## 0.2.5

- Specs and plans carry a `Status:` line. Specs go `draft → approved (date) → implemented (date)`, or `superseded by <path>`; plans go `draft → approved → in progress → done`. `brainstorming`, `writing-plans` and `executing-plans` set it at their natural points. Only the user approves, and `writing-plans` refuses a draft spec.

## 0.2.4

- New skill `writing-documentation`: where each document goes (README, topic docs, decision records, changelog, agent manifest, API reference, code comments), prose and comment rules, what a code change makes stale, and a verification step before "docs updated". Templates for a README, an ADR and a changelog entry.

## 0.2.3

- `brainstorming` writes a roadmap (`docs/specs/…-roadmap.md`) when a request splits into several subsystems: pieces, order, contracts, migration, open decisions. Each piece then gets its own cycle and is ticked off when finished.
- `using-skills` resumes a large project from its roadmap.

## 0.2.2

- `brainstorming` and the reviewer prompt name platform and domain skills consistently.

## 0.2.1

- Clearer description of the scope (platform, domain, new or existing code) and of the skill groups: process, starting point, platforms, high-risk domains.
- `using-skills` routes platform work and high-risk domain work to their skills separately.

## 0.2.0

First public release.

- Plugin `eng-kit` with a marketplace of the same name in `.claude-plugin/`.
- 26 skills:
  - 21 method skills: process core (design, plan, TDD, debugging, verification, review, git), starting point (stack choice, onboarding, legacy code), platforms (web, mobile, desktop) and high-risk domains (payments, POS, security);
  - 5 entry points: `implement`, `finish`, `new-task`, `verify`, `kit-init`.
- Agents: `reviewer` (opus, read-only) and `implementer` (sonnet).
- Hooks (Node ≥ 22.18, `.ts`):
  - SessionStart bootstrap;
  - PreToolUse guard (deny / ask);
  - PostToolUse tracker;
  - Stop verify gate, one reminder per prompt.
- Scripts: `verify.ts`, `init.ts` (dry run by default), and `install-project.ts` (installs into a project's `.claude/` folder, with manifest-based updates).
- `examples/demo`: a dependency-free project with one task, for trying the loop.
