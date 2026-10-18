import assert from "node:assert/strict";
import test from "node:test";
import { chapterAnchor, extractChangelog, parseIndex, rewriteLinks } from "../skills/publishing-documents/scripts/publish.ts";

test("parseIndex keeps the index order and only chapter links", () => {
	const readme = [
		"# Docs",
		"",
		"| Chapter | What |",
		"|---|---|",
		"| [02](02-flow.md) | flow |",
		"| [01](./01-setup.md) | setup |",
		"",
		"Decisions: [d](decisions/README.md). External: [x](https://e.com/03-x.md). Again: [02 again](02-flow.md).",
	].join("\n");
	assert.deepEqual(parseIndex(readme), ["02-flow.md", "01-setup.md"]);
});

test("extractChangelog returns one version's section", () => {
	const plain = "# Changelog\n\n## 0.2.0\n\n- b\n\n## 0.1.0\n\n- a\n";
	assert.equal(extractChangelog(plain, "0.2.0"), "- b");
	assert.equal(extractChangelog(plain, "0.1.0"), "- a");
	const kac = "# Changelog\r\n\r\n## [1.2.0] - 2026-10-01\r\n\r\n### Added\r\n\r\n- c\r\n\r\n## [1.1.0] - 2026-09-01\r\n\r\n- d\r\n";
	assert.equal(extractChangelog(kac, "1.2.0"), "### Added\n\n- c");
	assert.equal(extractChangelog(plain, "9.9.9"), null);
	assert.equal(extractChangelog(plain, "0.2"), null);
});

test("chapterAnchor is stable and ASCII-safe", () => {
	assert.equal(chapterAnchor("02-flow.md"), "ch-02-flow");
	const ru = chapterAnchor("01-обзор.md");
	assert.match(ru, /^ch-01-[0-9a-f]{8}$/);
	assert.equal(chapterAnchor("01-обзор.md"), ru);
	assert.notEqual(chapterAnchor("01-архитектура.md"), ru);
});

const repo = "/r";
const from = "/r/docs/01-setup.md";
const chapters = new Map([["/r/docs/01-setup.md", "ch-01-setup"], ["/r/docs/02-flow.md", "ch-02-flow"]]);

test("rewriteLinks: a link to another chapter becomes its anchor, without the fragment", () => {
	const { text, outside } = rewriteLinks("See [f](02-flow.md) and [o](02-flow.md#overview).", { from, chapters, repoDir: repo });
	assert.equal(text, "See [f](#ch-02-flow) and [o](#ch-02-flow).");
	assert.deepEqual(outside, []);
});

test("rewriteLinks: a link into the repo outside the document is reported", () => {
	const md = "Code: [c](../src/a.ts).";
	const { text, outside } = rewriteLinks(md, { from, chapters, repoDir: repo });
	assert.equal(text, md);
	assert.deepEqual(outside, ["docs/01-setup.md: ../src/a.ts"]);
});

test("rewriteLinks: with repoUrl the link is rewritten and keeps its fragment", () => {
	const { text, outside } = rewriteLinks("[c](../src/a.ts#L3) [r](/README.md)", {
		from,
		chapters,
		repoDir: repo,
		repoUrl: "https://git.example/r/blob/main",
	});
	assert.equal(text, "[c](https://git.example/r/blob/main/src/a.ts#L3) [r](https://git.example/r/blob/main/README.md)");
	assert.deepEqual(outside, []);
});

test("rewriteLinks: external links, anchors, mailto and code are left alone", () => {
	const md = [
		"[e](https://e.com/x.md) [a](#top) [m](mailto:a@b.c) [p](//cdn.example/x)",
		"Inline `[i](../src/a.ts)` stays.",
		"```md",
		"[k](../src/b.ts)",
		"```",
	].join("\n");
	const r = rewriteLinks(md, { from, chapters, repoDir: repo });
	assert.equal(r.text, md);
	assert.deepEqual(r.outside, []);
	assert.deepEqual(r.images, []);
});

test("rewriteLinks: local images are collected and moved to assets/", () => {
	const md = "![x](<img/a b.png>) ![y](img/схема.png) ![w](https://e.com/w.png)";
	const r = rewriteLinks(md, { from, chapters, repoDir: repo });
	assert.equal(r.text, "![x](<assets/1-a b.png>) ![y](<assets/2-схема.png>) ![w](https://e.com/w.png)");
	assert.deepEqual(r.images, ["/r/docs/img/a b.png", "/r/docs/img/схема.png"]);
});
