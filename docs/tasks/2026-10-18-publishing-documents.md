# Publishable HTML/PDF documents from the repo's Markdown

Status: design approved (2026-10-18)
<!-- draft → design approved (YYYY-MM-DD) → plan approved (YYYY-MM-DD) → in progress. Lives only on its work branch at docs/tasks/YYYY-MM-DD-<slug>.md: when the work is finished, what lasts moves to docs/ and this file is deleted. -->
Base: 1f8adc3b
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

None yet

## Progress

None yet
