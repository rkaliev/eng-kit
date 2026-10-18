# Publishable HTML/PDF documents from the repo's Markdown

Status: in progress
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 0bb6af7771fa21741489461a1c7dcc6a0398c0fb
Links: None

<details><summary>Original request</summary>

«а есть ли в fortune os скилл поомогающий писать документацию красивую человекопонятную которую можно отдельно публиковать и перенесли ли мы его? у нас такое есть?» → «мне нужно все, давай начинать от простого к сложному планируй если необходимо или продумай». This is the third of three tasks (after diagrams, 0.28.0, and a docs site, 0.29.0). Answers in this session: all four kinds of document (project docs for outsiders, reports and proposals, branded documents, client release notes); approach «Markdown + standard tools»; a build script in the kit — «Yes, scripts/publish.ts».

</details>

## Intent

An agent using the kit can hand a partner, client or manager a good-looking single-file HTML and a PDF built from Markdown kept in the repo, in the project's brand, checked before it leaves, with one command.

## Context

writing-documentation covers docs that live in the repo and, since 0.29.0, a site built from `docs/`; nothing covers a standalone file for readers outside the repo. The reference project solves this with `pdf-create`, a bundled React-PDF renderer fed by content JSON: strong output, but a Node project inside the kit and text outside reviewable Markdown. A probe on this machine (pandoc 3.8.3, Typst 0.15.1, mermaid-cli 11) built HTML with `--embed-resources` and PDF through `--pdf-engine=typst` from one Markdown file, with a contents page, highlighted code, a vector diagram and Cyrillic text; pandoc's Typst template imports a `conf` function from `-V template=<file.typ>`, so a brand theme needs no fork of pandoc's template.

## Success criteria

| # | Criterion (observable, testable) | How it is verified |
|---|---|---|
| 1 | A skill `publishing-documents` exists, byte-identical in both editions, lints clean, and its description triggers on a PDF, a standalone HTML, a report, a proposal or release notes for clients | `tests/lint-skills.test.ts` in both editions; `tools/compare-editions.mts`; a fresh agent asked in plain words loads it (manual: the trigger is model behaviour, not code — agreed by the user 2026-10-18) |
| 2 | `publish.ts <file.md> --out <dir>` writes `<dir>/<name>.html` (one file, no external `src`/`href` to local files) and `<dir>/<name>.pdf`, prints `{"html":…,"pdf":…}` and exits 0 | integration test (runs only where pandoc and Typst are installed: skip reason `mode: needs pandoc and typst`; skipped in kit CI, run locally before release — agreed by the user 2026-10-18) |
| 3 | `--docs` builds one document from the chapters linked in `docs/README.md`, in the index's order; a link from one chapter to another becomes a link inside the document | unit tests for index parsing and link rewriting; integration test |
| 4 | `--changelog <version>` builds from that version's CHANGELOG section; an unknown version exits non-zero naming it | unit test for section extraction; integration test for the exit |
| 5 | Mermaid blocks are rendered to SVG before pandoc, without a "diagram" caption; a diagram that fails to render exits non-zero naming the file | integration test with a valid and a broken diagram |
| 6 | A link into the repo that isn't part of the document exits non-zero listing each link, unless `--repo-url <url>` is given, then it is rewritten to `<url>/<path>` | unit tests for link classification and rewriting |
| 7 | A missing tool (pandoc, Typst, or mermaid-cli when a diagram is present) exits non-zero naming the tool before any output is written | unit test with a stubbed PATH |
| 8 | Without `--theme` the kit's theme is used: a cover page with title, subtitle, audience, version and date, a contents page, a running header and page numbers, one accent colour; `--theme <dir>` uses the project's `brand.typ` and `brand.css`; `--init-theme <dir>` copies the kit's theme there | integration test for the three paths; the PDF's pages looked at once and described in Progress |
| 9 | The skill says: the source stays Markdown in the repo; output goes to an ignored folder; before handing a file over, the agent looks at every page, removes what isn't for that audience, and leaves sending or publishing to the user | RED/GREEN: a fresh agent asked to make a partner PDF from `docs/` — without the skill, then with it; the transcript and output compared |
| 10 | Release 0.30.0 in both editions: CHANGELOG, ARCHITECTURE(.ru), versions, pi pins; verify and `node .github/release.ts check` pass | the commands' output |

## Scope

**In scope:**
- `skills/publishing-documents/`: `SKILL.md`, `scripts/publish.ts`, `templates/brand.typ`, `templates/brand.css`, references if the body would pass 500 words.
- `tests/publish.test.ts` in both editions.
- Release metadata for 0.30.0.

**Out of scope:**
- Sending, uploading or publishing a file anywhere (the user does it).
- DOCX, slides, EPUB.
- Editing or extracting from existing PDFs.
- Installing pandoc, Typst or mermaid-cli for the user; the script names what is missing and how to install it.
- A docs site (0.29.0) and diagrams rules (0.28.0), which this reuses.

## Decisions

1. Markdown + standard tools, not a bundled renderer: the text stays reviewable in the repo; pandoc, Typst and mermaid-cli are single tools any stack can install (user, this session).
2. A build script in the kit, `publish.ts`, deterministic and tested (user, this session).
3. The skill, script and theme live in one skill folder so the editions stay byte-identical; the script runs on Node ≥ 22.18 as `.ts`, with no npm dependencies, like the other kit scripts.
4. The theme belongs to the project once copied (`docs/publish/theme/` by default); the kit's copy is only a starting point and never overrides it.
5. A failed check exits non-zero with every finding listed; the script never produces a partial document.
6. **assumed:** output goes to a folder the user names with `--out`; the skill recommends an ignored folder and never committing the files.

## Design

- `publish.ts` (one file): parse args → collect sources (file | `--docs` | `--changelog`) → check tools → pre-render Mermaid (mermaid-cli into a temp dir, alt text from the diagram's `accTitle` when present) → check and rewrite links → write one combined Markdown with frontmatter → pandoc to HTML (`-s --embed-resources --toc`, `brand.css`) and to PDF (`--pdf-engine=typst -V template=brand.typ --toc`) → print JSON.
- Pure functions exported for tests: index parsing, CHANGELOG section extraction, link classification/rewriting, chapter anchors.
- `brand.typ` exports `conf(...)` for pandoc's Typst template: cover, contents, header/footer, accent colour and font variables at the top. `brand.css` mirrors the colour and fonts for HTML.

## Rollout

None: a new skill; nothing installed into projects changes until the user updates the kit.

## Risks and open questions

- pandoc's Typst template variables change between pandoc versions → the script checks a minimum pandoc version and the theme uses only `conf` arguments present in the probe's version.
- Kit CI has no pandoc or Typst → the integration test skips there; the unit tests cover the logic, and the integration test runs locally before release.
- mermaid-cli needs a headless Chromium → the script only calls it when a diagram is present, and names it when it fails.

## Follow-ups

- Brand theme from a `design.md` file (tokens → `brand.typ`), as the reference project does.
- DOCX output for readers who edit the document.

## Plan

> Execute with the executing-plans skill. Only this section uses `- [ ]` checkboxes.

**Goal:** a `publishing-documents` skill with a tested `publish.ts` that turns the repo's Markdown into a branded single-file HTML and a PDF, in both editions.
**Architecture:** one skill folder (`SKILL.md`, `scripts/publish.ts`, `templates/brand.typ`, `templates/brand.css`) copied byte for byte into both editions. `publish.ts` exports pure helpers (tested directly) and a `main(argv)` that collects sources, checks tools and links, pre-renders Mermaid per source file, writes one combined Markdown into a temp build dir, then runs pandoc twice (HTML, PDF via Typst).
**Stack / constraints:** Node ≥ 22.18 running `.ts` directly, no npm dependencies (only `node:` modules); pandoc ≥ 3.8 (the version the theme was tested on: 3.8.3), Typst on PATH (tested 0.15.1), `@mermaid-js/mermaid-cli` (`mmdc`) only when a source has a Mermaid block. Exit codes: 0 built, 1 a check failed (every finding on stderr, one per line, nothing written to `--out`), 2 usage error. Stdout on success: `{"html":"<abs path>","pdf":"<abs path>"}`. Skip reason for the integration tests: `mode: needs pandoc and typst`. Code style: tabs, as in `scripts/test-hygiene.ts`.
**Verification:** from the workspace root, `node "<kit root>/scripts/verify.ts"` (typecheck and tests of `src` and `src_claude`); in each repo `node .github/release.ts check`; `node tools/compare-editions.mts` at the workspace root.

### Review focus
1. Two chapters with the same heading (`## Overview`): a cross-chapter `NN-x.md#overview` link must not land in the wrong chapter → such links go to the chapter anchor and drop the fragment (test in Task 2).
2. Source paths with spaces and Cyrillic (`docs/01-обзор.md`) → test in Task 2 and in the integration test of Task 4.
3. CHANGELOG with CRLF line endings and `## [1.2.0] - 2026-10-01` headings → test in Task 1.
4. `docs/README.md` that links no chapter → exit 1 `no chapters linked in docs/README.md` (test in Task 4).
5. A relative image (`![x](img/a.png)`) must survive into both outputs although pandoc and Typst run in a temp dir → test in Task 4.

### Post-implementation
- `CHANGELOG.md` (both): `## 0.30.0` entry.
- `docs/ARCHITECTURE.md` and `.ru.md` (both): the new skill and why (Claude edition: a paragraph after "Docs site"; pi: a table row).
- `README.md` (both): skill count 34 → 35 (Claude) and 28 → 29 (pi), and "publishing documents" in the process core list.
- Versions 0.30.0 (Claude: `package.json`, `package-lock.json`, `.claude-plugin/plugin.json`; pi: `package.json`, `package-lock.json`, `@v0.30.0` pins in `README.md`, `docs/GETTING-STARTED(.ru).md`, `templates/settings.json`).
- No topic chapter: the kit documents itself in ARCHITECTURE. No decision record: the decisions are in the CHANGELOG entry and the private FRAMEWORK-SOURCES §11.42.

### Files

| File | Responsibility |
|---|---|
| `skills/publishing-documents/SKILL.md` | when to publish, the workflow, the checks before handing a file over |
| `skills/publishing-documents/scripts/publish.ts` | the build: helpers + `main` |
| `skills/publishing-documents/templates/brand.typ` | the kit's PDF theme: `conf(...)` for pandoc's Typst template |
| `skills/publishing-documents/templates/brand.css` | the kit's HTML theme |
| `tests/publish.test.ts` | unit tests for the helpers, integration tests for `main` |
| `tsconfig.json` | add `"skills/**/*.ts"` to `include` (both editions) |

### Task 1: sources (index, CHANGELOG section, chapter anchors)

**Files:** Create `skills/publishing-documents/scripts/publish.ts` · Modify `tsconfig.json` · Test `tests/publish.test.ts`
**Interfaces:** Produces `parseIndex(readme: string): string[]` · `extractChangelog(text: string, version: string): string | null` · `chapterAnchor(file: string): string`

- [x] Add `"skills/**/*.ts"` to `tsconfig.json` `include`; create `publish.ts` with the three exports returning `[]`, `null`, `""`
- [x] Write failing tests:
  - `parseIndex keeps the index order and only chapter links`: input with a table linking `[02](02-flow.md)`, `[01](./01-setup.md)`, `[d](decisions/README.md)`, `[x](https://e.com/03-x.md)`, `[02 again](02-flow.md)` → `["02-flow.md","01-setup.md"]`
  - `extractChangelog returns one version's section`: `## 0.2.0\n\n- b\n\n## 0.1.0\n\n- a\n` with `"0.2.0"` → `"- b"`; with `"[1.2.0] - 2026-10-01"` style heading and CRLF → the section text with `\n` line endings; unknown `"9.9.9"` → `null`
  - `chapterAnchor is stable and ASCII-safe`: `"02-flow.md"` → `"ch-02-flow"`; `"01-обзор.md"` → `"ch-01"` followed by a hex hash of the name (same input → same output, two names → two anchors)
- [x] Run `npm test -- tests/publish.test.ts` → expect FAIL: `[]` vs `["02-flow.md","01-setup.md"]`, `null` vs `"- b"`, `""` vs `"ch-02-flow"`
- [x] Implement: chapter link = relative href (optional `./`) matching `^\d+-[^/]+\.md$`, first occurrence wins; a CHANGELOG heading matches `^## \[?<version>\]?(\s|$)`; anchor = `ch-` + the name without `.md` when it is `[a-z0-9-]+`, else `ch-<leading digits>-<first 8 hex of sha1(name)>`
- [x] Run `npm test -- tests/publish.test.ts` → PASS, then `npm test` → all pass
- [x] Commit `feat(publishing-documents): sources from the docs index and the changelog`

### Task 2: link checks and rewriting

**Files:** Modify `publish.ts` · Test `tests/publish.test.ts`
**Interfaces:** Consumes `chapterAnchor` · Produces `rewriteLinks(md: string, o: { from: string; chapters: Map<string, string>; repoDir: string; repoUrl?: string }): { text: string; outside: string[]; images: string[] }` (`from` and map keys are absolute paths; `images` are the absolute paths of local images, in order)

- [x] Stub returning `{ text: md, outside: [], images: [] }`; write failing tests:
  - `a link to another chapter becomes its anchor`: `[f](02-flow.md)` and `[f](02-flow.md#overview)` from `docs/01-setup.md` with `02-flow.md` in `chapters` → `[f](#ch-02-flow)` both times (review focus 1)
  - `a link into the repo outside the document is reported`: `[c](../src/a.ts)` → `outside` is `["docs/01-setup.md: ../src/a.ts"]`, text unchanged
  - `with repoUrl it is rewritten instead`: `repoUrl` `https://git.example/r/blob/main` → `[c](https://git.example/r/blob/main/src/a.ts)`, `outside` empty; a `#frag` is kept
  - `external links, anchors and mailto are left alone`
  - `local images are collected and rewritten to assets/`: `![x](img/a b.png)` → `![x](assets/<n>-a b.png)`, `images` holds its absolute path (review focus 2: also a Cyrillic file name)
- [x] Run `npm test -- tests/publish.test.ts` → FAIL on each of those assertions
- [x] Implement with one inline-link regex for `[text](href)` and `![alt](src)` (no reference-style links; the skill says so); resolve with `node:path`, report paths relative to `repoDir` with `/`
- [x] Run the file's tests → PASS, then `npm test`
- [x] Commit `feat(publishing-documents): check and rewrite links for a standalone document`

### Task 3: tool check

**Files:** Modify `publish.ts` · Test `tests/publish.test.ts`
**Interfaces:** Produces `checkTools(o: { mermaid: boolean }, run?: (cmd: string, args: string[]) => { status: number | null; stdout: string }): string[]` (empty when all present; default `run` is `spawnSync`)

- [x] Stub returning `[]`; write failing tests with a fake `run`:
  - `missing pandoc is named with how to install it`: `run` returns `status: null` for `pandoc` → one finding starting `pandoc not found`
  - `old pandoc is rejected`: `pandoc 3.7.0` → finding `pandoc 3.7.0 is older than 3.8`
  - `typst is required`; `mmdc is required only with diagrams`: `{ mermaid: false }` never calls `mmdc`
- [x] Run → FAIL; implement (`pandoc --version` first line, `typst --version`, `mmdc --version`); run → PASS, then `npm test`
- [x] Commit `feat(publishing-documents): check the build tools before writing anything`

### Task 4: theme and build (`main`)

**Files:** Create `templates/brand.typ`, `templates/brand.css` · Modify `publish.ts` · Test `tests/publish.test.ts`
**Interfaces:** Consumes Tasks 1–3 · Produces `main(argv: string[]): number` and the CLI `node publish.ts (<file.md> | --docs [<dir>] | --changelog <version> [<file>]) --out <dir> [--theme <dir>] [--repo-url <url>] [--title …] [--subtitle …] [--audience …] [--version …] [--date …] [--lang …]` and `node publish.ts --init-theme <dir>`

- [x] `brand.typ`: `#let accent = rgb("#1f4e79")`, fonts `("Libertinus Serif",)` and code `("DejaVu Sans Mono",)` at the top; `conf(title, subtitle, authors, keywords, date, lang, region, paper: "a4", font, fontsize, pagenumbering, cols, ..rest, doc)`: a cover page (title, subtitle, authors, each keyword on its own line, date), then a page break, a header with the title in `accent` and page numbers `1 / N` in the footer from page 2; `brand.css`: the same accent and fonts for pandoc's HTML
- [x] Integration tests (each `t.skip("mode: needs pandoc and typst")` when `checkTools({ mermaid: true })` isn't empty), in a temp repo:
  - `builds HTML and PDF from one file`: exit 0, stdout JSON with both paths, the HTML has no `src="` or `href="` to a local file (criterion 2)
  - `--docs follows the index and links chapters inside the document`: chapters 02 then 01 in the index → the HTML has `id="ch-02-flow"` before `id="ch-01-setup"` and `href="#ch-02-flow"` (criterion 3); an index without chapters → exit 1 `no chapters linked in docs/README.md` (review focus 4)
  - `--changelog builds one version and rejects an unknown one`: exit 0 for `0.2.0`; exit 1 with `version 9.9.9 not found in CHANGELOG.md` (criterion 4)
  - `diagrams become SVG without a caption; a broken one fails`: the HTML contains `<svg` and no `Figure 1`; alt text from `accTitle`; a broken diagram → exit 1 naming the source file, `--out` empty (criterion 5)
  - `a link into the repo fails the build unless --repo-url`: exit 1 listing it; with `--repo-url` exit 0 (criterion 6)
  - `a relative image reaches both outputs` (review focus 5) and a Cyrillic chapter name builds (review focus 2)
  - `themes: default, project, init`: `--init-theme <dir>` writes `brand.typ` and `brand.css` equal to the kit's; `--theme <dir>` with a changed accent shows it in the HTML (criterion 8)
- [x] Run `npm test -- tests/publish.test.ts` → expect FAIL (main returns 2 for every call while stubbed)
- [x] Implement `main`: parse args (unknown flag → 2); collect sources; metadata from frontmatter, then flags (`--docs` title defaults to the index's `# ` heading, `--changelog` title to `Release notes <version>`, date to today in ISO, lang to `en`); audience and version go to pandoc as `keywords` (`Audience: …`, `Version: …`), the only list pandoc's Typst template forwards to `conf`; check tools; per source: mmdc into the build dir when it has a Mermaid block, then `rewriteLinks`; collect every finding before failing; copy images to `assets/`; write `doc.md`; run `pandoc doc.md -f markdown-implicit_figures -s --toc --embed-resources --css brand.css -o <name>.html` and `pandoc doc.md -f markdown-implicit_figures --toc --pdf-engine=typst -V template=brand.typ -o <name>.pdf` with the build dir as cwd; copy both into `--out` only after both succeed
- [x] Run the file's tests → PASS locally (pandoc 3.8.3, Typst 0.15.1, mmdc 11), then `npm test`
- [x] Build the probe document and look at every PDF page; record in Progress what the cover, contents, header and footer show
- [x] Commit `feat(publishing-documents): build branded HTML and PDF with one command`

### Task 5: the skill text (criteria 1, 9)

**Files:** Create `skills/publishing-documents/SKILL.md` (+ `references/` only if the body passes 500 words)

- [ ] RED: a fresh agent without the skill, on a fixture repo with `docs/` (an internal decision record, a link to code, a Mermaid diagram): "Make a PDF of our docs for partner X, we'll send it today." Record what it does (source, tool, checks, what reaches the PDF, whether it sends anything)
- [ ] Write `SKILL.md`: frontmatter `description: Use when someone needs a document outside the repo — a PDF, a single-file HTML, a report, a proposal, or release notes for clients…` (≤ 300 characters); body: source stays Markdown (`docs/publish/<doc>.md` with frontmatter title, subtitle, audience, version, date, lang), the three source modes, the command, theme setup (`--init-theme docs/publish/theme`), output in an ignored folder, what to check before handing over (every page looked at; nothing internal for that audience; links into the repo resolved; diagrams with `accTitle`), sending and publishing left to the user, and that missing tools are installed with the user's agreement
- [ ] GREEN: the same scenario with the skill's text → the agent uses `publish.ts`, removes or flags what isn't for partners, looks at the pages, doesn't send; record both runs in Progress
- [ ] Trigger: a fresh agent with the kit installed asked in plain words loads the skill (manual, agreed)
- [ ] `npm test` (lint) → PASS; commit `feat(publishing-documents): the skill`

### Task 6: the pi edition and release 0.30.0 (criteria 1, 10)

**Files:** in `src/`: copy `skills/publishing-documents/`, `tests/publish.test.ts`, the `tsconfig.json` include; both editions: Post-implementation docs and versions

- [ ] Copy; `diff -r` of the skill folders and of the two test files prints nothing; `node tools/compare-editions.mts` reports no drift for the skill
- [ ] Post-implementation items above
- [ ] Verify from the workspace root → all pass; `node .github/release.ts check` in each repo → `ok 0.30.0`
- [ ] Commit in each repo `feat(publishing-documents): publishable HTML/PDF documents (0.30.0)`

## Progress

- Baseline (eb23a09): verify from the workspace root passes (typecheck and tests of src and src_claude). Drift: none (every plan file is new except tsconfig.json, unchanged since Base). Pre-flight: Interfaces of Tasks 1–4 agree.
- Ruling: a minimal SKILL.md added in Task 1 — the skill lint requires one in every skills/ folder and the plan wrote it only in Task 5 — none, Task 5 replaces it.
- Task 1: complete (eb23a09..78402f9, npm test → 486 pass, 0 fail; publish tests seen failing first: [] vs [02-flow.md, 01-setup.md], null vs '- b', '' vs 'ch-02-flow').
- Ruling: image links are written as `<…>` (pandoc's form for paths with spaces), so the test input is `![x](<img/a b.png>)` rather than the plan's bare form — a bare path with a space isn't a Markdown link — none.
- Ruling: added a test that links in fenced and inline code are left alone (plan didn't list it; a code sample would otherwise fail the build) — none.
- Task 2: complete (635262e..d8b9126, npm test → 491 pass, 0 fail; four rewriteLinks tests seen failing on the stub; the code test seen failing with code skipping removed).
- Task 3: complete (e08300b..7ea94ef, npm test → 495 pass, 0 fail; three checkTools tests seen failing on the stub; "everything present" passes on the stub by design and guards against false findings).
- Ruling: audience and version reach the cover through pandoc's `thanks` field, not `keywords` — pandoc 3.8.3's Typst template loops `keywords` with `$keyword$` and emits `keywords: (,)`, a Typst syntax error — if a later pandoc forwards custom fields, the theme can move to them.
- Ruling: `rewriteLinks` takes `assetsDir` (default `assets`), and main passes `assets/<source n>` so images of different chapters can't collide — none.
- Ruling: alt text comes from mmdc itself, which writes a diagram's `accTitle` as the image title; main moves it into the alt — none.
- Ruling: the integration tests' skip reason is `mode: needs pandoc, typst and mmdc` (the plan named only pandoc and typst; the diagram test also needs mmdc) — none.
- Task 4: complete (665e374..31ac22f; with pandoc 3.8.3, Typst 0.15.1 and mmdc 11 on PATH: publish tests 19 pass, the 7 build tests seen failing first on the stub (exit 2) and once on the alt text before the fix; npm test without those tools → 495 pass, 7 skipped with the reason). The sample PDF, looked at page by page: cover with accent bar, title, subtitle, "Audience: Partners" and "Version: 1.2" on their own lines, author and date; contents on page 1/2; running header with title and subtitle; footer "n / N"; the diagram as vector SVG without a caption.
