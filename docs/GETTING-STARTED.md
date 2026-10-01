# Getting started: eng-kit for Claude Code

Russian version: [GETTING-STARTED.ru.md](GETTING-STARTED.ru.md)

Repository: [github.com/rkaliev/eng-kit](https://github.com/rkaliev/eng-kit).

## 0. What you need

- **Claude Code**, latest version. Check: `claude --version`; update: `claude update`. Installation is described at [code.claude.com/docs](https://code.claude.com/docs/en/setup).
- **Node.js ≥ 22.18** (`node --version`). The kit's hooks are `.ts` files, and Node runs them without a build step. On an older Node, Claude Code still works, but without the guard and the verify gate.
- **git**: reviews over a commit range and finishing a branch depend on it.

---

## 1. What a plugin is, with a simple example

A good analogy is the app store on a phone:

| Phone | Claude Code | In our case |
|---|---|---|
| App store | **Marketplace**: a git repository with a `.claude-plugin/marketplace.json` catalog | `rkaliev/eng-kit` |
| App | **Plugin**: a folder with `.claude-plugin/plugin.json` and components | `eng-kit` |
| Installing an app | `claude plugin install <plugin>@<marketplace>` | `eng-kit@eng-kit` |

In our repository the marketplace and the plugin live together: the catalog lists one plugin, and that plugin is the repository itself. That is why the name appears twice: `eng-kit@eng-kit`.

### What's inside the plugin

```
eng-kit/
├── .claude-plugin/plugin.json      passport: name, version, description
├── .claude-plugin/marketplace.json catalog: "this repository has the eng-kit plugin"
├── skills/<name>/SKILL.md          skills: instructions the agent loads when the situation fits
├── agents/*.md                     subagents: separate "workers" with their own model and tools
└── hooks/hooks.json                hooks: code that Claude Code runs itself on events
```

- **A skill** is a playbook. Every skill has a description of the form "Use when…". Claude sees all descriptions and loads the right skill itself when the situation matches (for example, "bug" → `systematic-debugging`). You can also call any skill by hand: `/eng-kit:systematic-debugging`. The `eng-kit:` prefix is the plugin's namespace; it prevents name clashes with other plugins.
- **An agent** is a worker with a fresh context. Claude hands it a task and gets back only the result. We have two: `reviewer` (reviewer: read-only, opus) and `implementer` (executes one plan task: sonnet).
- **A hook** is not text but a program. The model can't "forget" it or "talk it out of" anything: Claude Code runs it itself. Our hooks do three things: load the rules at session start, block dangerous commands, and don't let work finish without a test run.

### Where it's installed and where it lives

| Scope (`--scope`) | Where it's recorded | Who gets the plugin |
|---|---|---|
| `user` (default) | `~/.claude/settings.json` | You, in all projects |
| `project` | the project's `.claude/settings.json` (committed) | Everyone who opens the project |
| `local` | `.claude/settings.local.json` (not committed) | Only you, only in this project |

Claude Code copies the plugin files into the cache `~/.claude/plugins/cache/…`, and the settings keep a single line: `"enabledPlugins": {"eng-kit@eng-kit": true}`. So nothing is copied into the project itself.

### What happens in a session

```
claude ─▶ SessionStart hook ─▶ into context: using-skills rules + paths to kit scripts
   │
   ├─ you: "add a discount to the cart" ─▶ Claude sees the brainstorming description ─▶ loads the skill
   │                                      (or you yourself: /eng-kit:implement docs/tasks/2026-09-26-discount.md)
   │
   ├─ every tool call ─▶ PreToolUse hook (guard)
   │        git push           ─▶ "ask the human"
   │        git push --force   ─▶ "denied"
   │        Read .env          ─▶ "denied"
   │        gh pr create       ─▶ "denied" while a task file is in git
   │                              or without a reviewer "Yes" for HEAD
   │        npm test           ─▶ no opinion (normal permissions decide)
   │
   ├─ Edit / Write ─▶ PostToolUse hook: "workspace unverified"
   │  npm test ✓     ─▶ "verified"
   │
   ├─ review ─▶ agent eng-kit:reviewer (fresh context, opus) ─▶ report
   │
   └─ Claude wants to finish ─▶ Stop hook: any unverified edits?
                                  yes ─▶ "run the checks first" (once per prompt)
                                  an approved task file uncommitted? ─▶ "commit it on a work branch"
                                  its Plan fully ticked? ─▶ "move what lasts to docs/, show Follow-ups, delete it"
                                  no  ─▶ answer to you
```

### How to update

```bash
claude plugin marketplace update eng-kit     # pull the fresh catalog
claude plugin update eng-kit@eng-kit          # update the plugin (then restart the session)
```

The version number comes from `plugin.json`. The list of changes is in [CHANGELOG.md](../CHANGELOG.md).

---

## 2. A new project in 5 minutes (recommended path)

**Step 1. Once per machine**, install the plugin for yourself, in all projects:

```bash
claude plugin marketplace add rkaliev/eng-kit
claude plugin install eng-kit@eng-kit
claude plugin list                            # eng-kit@eng-kit · ✔ enabled
```

**Step 2. A new project:**

```bash
mkdir shop-api && cd shop-api
git init
claude
```

**Step 3. Inside Claude Code:**

```
/eng-kit:brainstorming REST API for an online store cart: products, discounts, total
```

The agent classifies the work. A new project is "Architectural", so next it asks questions one at a time. Choosing a stack is a fork, and the agent offers 2–3 options with a recommendation. Then it writes the task file `docs/tasks/…-cart-api.md` and asks you to approve the description. No code is written before that point.

**Step 4.** Once the project exists (there is a `package.json`, `go.mod` and so on):

```
/eng-kit:kit-init
```

The agent shows a plan and, on your "yes", creates `.claude/verify.json` (the test commands found in the project), `.claude/guard.json` and deny rules for secrets. It also offers the optional test-hygiene check for CI (`.ci/test-hygiene.ts`) and adds it only if you agree. If there is no CLAUDE.md, it suggests `/eng-kit:onboarding-existing-codebase` to build CLAUDE.md from the code.

**Step 5. Then the working loop:**

```
/eng-kit:writing-plans docs/tasks/…-cart-api.md     fills its Plan: small TDD tasks
/eng-kit:implement docs/tasks/…-cart-api.md         execution with tests and a report; at the end
                                                    what lasts moves to docs/, the task file is deleted
/eng-kit:requesting-code-review                     review by the reviewer agent
/eng-kit:finish                                     merge / PR / keep / discard, your choice
```

The task file (description, plan and progress in one file) lives only on the work branch, and the guard won't open a PR or merge while it exists. The details: [WALKTHROUGH.md](WALKTHROUGH.md).

For a small change one line is enough: `/eng-kit:implement add quantity validation > 0`.

A detailed walk through all steps with dialogue examples: [WALKTHROUGH.md](WALKTHROUGH.md).

**Why this path is the most convenient:** you install once, and the plugin works in all projects. The project repository has no foreign files except `.claude/verify.json` and `.claude/guard.json`. Updating is one command.

---

## 3. Check that everything is installed

Adding the marketplace doesn't install the plugin yet: `marketplace add` only connects the catalog; skills appear after `install`.

**From the terminal:**
```bash
claude plugin list                 # eng-kit@eng-kit · Status: ✔ enabled · Version: 0.2.x
claude plugin details eng-kit      # Skills (33), Agents (2), Hooks (6)
```

**Inside Claude Code** (after restarting the session or `/reload-plugins`):

| What to check | How | What you should see |
|---|---|---|
| Skills | type `/eng-kit:` | the menu shows `implement`, `brainstorming`, `kit-init`, `verify`, … |
| Hooks | `/hooks` | SessionStart, PreToolUse, PostToolUse, Stop, UserPromptSubmit → `…/eng-kit/…/hooks/hook.ts` |
| Agents | `/agents` | `eng-kit:reviewer`, `eng-kit:implementer` |
| Rules loaded | "Reply only with the line from your context that starts with 'Kit root'" | `Kit root: …/.claude/plugins/cache/eng-kit/eng-kit/0.2.x` |
| Guard | "Run git push --force origin main" | denial "Guard: Force-pushing rewrites shared history…"; a plain `git push` shows a confirmation dialog |
| Verify gate | `/eng-kit:kit-init`, then a small edit without tests | at the end "Verify gate: files changed…", and the agent runs the tests before reporting |

If the skills are visible but the guard and the gate don't fire, check `node --version` (≥ 22.18 required) and folder trust. `claude --debug` shows hook errors.

## 4. For a team

In the project root:

```bash
claude plugin marketplace add rkaliev/eng-kit --scope project
claude plugin install eng-kit@eng-kit --scope project
git add .claude/settings.json && git commit -m "chore: enable eng-kit"
```

`.claude/settings.json` will contain:

```json
{
  "extraKnownMarketplaces": { "eng-kit": { "source": { "source": "github", "repo": "rkaliev/eng-kit" } } },
  "enabledPlugins": { "eng-kit@eng-kit": true }
}
```

**What a colleague sees:** they clone the project, run `claude` and confirm trust in the folder. After that Claude Code offers to install the marketplace and the plugin. Until the folder is trusted, plugins from the project file aren't installed: someone else's repository can't silently install anything for you.

Commit the rest of `.claude/` too (except `settings.local.json`): then the team has the same checks and rules.

---

## 5. Alternative: a `.claude/` folder in the project

Use this option when plugins aren't allowed (an isolated network, company policy) or when skills need to be edited for a specific project. Everything lives in the repository, and skills are called without a prefix (`/implement`).

```bash
git clone https://github.com/rkaliev/eng-kit
node eng-kit/scripts/install-project.ts <project folder>          # dry run: shows what will be done
node eng-kit/scripts/install-project.ts <project folder> --yes    # install
```

What appears:
- `.claude/skills/*`: 34 skills;
- `.claude/agents/reviewer.md`, `implementer.md`;
- `.claude/eng-kit/`: hook code, scripts, templates, `manifest.json`;
- `.claude/settings.json`: hooks and deny rules for secrets;
- `.claude/verify.json`, `.claude/guard.json`, if they didn't exist.

**Updating:** the same command with `--yes` from a fresh clone. Files the kit wrote are updated. Project files with the same names stay untouched and are listed as `conflict`.

**Don't mix the modes:** if the project has the folder, don't enable the plugin there, or the hooks fire twice.

| | Plugin | `.claude/` folder |
|---|---|---|
| Install | one command, once | a script in every project |
| In the project repository | 2–3 small files | ~50 kit files |
| Update | `claude plugin update` | re-run the script |
| Commands | `/eng-kit:implement` | `/implement` |
| Editing skills for the project | no (fork the plugin) | yes, right in `.claude/skills/` |

---

## 6. Try it on the demo project

```bash
git clone https://github.com/rkaliev/eng-kit
cp -r eng-kit/examples/demo /tmp/kit-demo
cd /tmp/kit-demo && git init -q && git add -A && git commit -qm init
npm test            # 2 tests, green
claude
```

| Step | What to type | What you'll see |
|---|---|---|
| 1 | `/eng-kit:kit-init` | A plan, then `verify.json` with `npm test`: the agent took it from CLAUDE.md |
| 2 | `/eng-kit:implement tasks/01-percent-discount.md` | A plan of up to 7 lines, then TDD: a failing test for each criterion first. The task is about money, so `payments-and-money` kicks in: integer arithmetic only and half-up rounding |
| 3 | (the agent says "done") | If there were no checks after the edits, the Stop hook sends the agent back ("Verify gate: files changed…"), and the report has real results |
| 4 | `/eng-kit:requesting-code-review` | The `reviewer` agent: Criteria / Confirmed / Assumptions / Questions / Verdict |
| 5 | `/eng-kit:finish` | Options merge / PR / keep / discard. Push and merge happen only after your choice |

**How to check the guard:**
- `git push --force`: denied, with a hint about `--force-with-lease`;
- `git push`: a question;
- `git commit --no-verify`: denied;
- `gh pr create` while `docs/tasks/` has tracked files, or without a reviewer `Yes` for HEAD: denied.

`/hooks` shows the registered hooks, `claude plugin details eng-kit` shows everything the plugin loaded.

---

## 7. Models

- **Agents:** `reviewer` runs on `opus`, `implementer` on `sonnet`. To move all subagents to one model, set `CLAUDE_CODE_SUBAGENT_MODEL` and `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` in the settings `env`.
- **Skills:** skills with heavy reasoning (brainstorming, writing-plans, systematic-debugging, security-review) set `effort: high`.
- **Main session:** `/model`, `--model`, all built in.

## 8. FAQ

- **I added the marketplace, but there are no skills.** The plugin isn't installed: `claude plugin install eng-kit@eng-kit`, then restart the session or `/reload-plugins`. To check, see section 3.
- **Hooks don't fire.** Check `node --version` (≥ 22.18 required) and `/hooks`. Project hooks need folder trust. Debugging: `claude --debug`.
- **The verify gate says there are no commands.** Fill in `.claude/verify.json` or the `## Commands` section in CLAUDE.md.
- **I need push without a question.** A narrow rule in `.claude/guard.json`: `"allow": ["^git push origin (feat|fix)/"]`. This rule doesn't lift blocks (`--force`, `--no-verify`).
- **The guard denies `gh pr create` or a merge: "Review gate: …".** The branch's code has no reviewer `Yes`. Run `/eng-kit:requesting-code-review`, fix its findings and review the new range. Land in a command of its own, not chained after `git commit` or `git switch`. Docs and task files don't need a review; CLAUDE.md, skills and `.claude/` do. Only you turn it off: `"reviewGate": false` in `.claude/guard.json`.
- **My project keeps task files elsewhere, or in the repo for good.** The `workDocs` key in `.claude/guard.json` lists the task-file folders (default `["docs/tasks"]`); `[]` turns that rule off.
- **I want to disable the plugin temporarily.** `claude plugin disable eng-kit@eng-kit`; to turn it back on, `enable`.
- **Uninstall.** `claude plugin uninstall eng-kit@eng-kit`, then `claude plugin marketplace remove eng-kit`.
- **Windows.** The hooks are Node scripts, and the guard understands the PowerShell tool. This scenario hasn't been run on Windows yet.

How it all works and why: [ARCHITECTURE.md](ARCHITECTURE.md).
