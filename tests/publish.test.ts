import assert from "node:assert/strict";
import test from "node:test";
import { chapterAnchor, extractChangelog, parseIndex } from "../skills/publishing-documents/scripts/publish.ts";

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
