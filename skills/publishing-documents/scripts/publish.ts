/**
 * Builds a standalone HTML file and a PDF from the repo's Markdown, for readers outside the repo.
 */

import { createHash } from "node:crypto";

const CHAPTER = /^\d+-[^/]+\.md$/;

/** Chapter files linked from a docs index (`docs/README.md`), in the index's order. */
export function parseIndex(readme: string): string[] {
	const chapters: string[] = [];
	for (const m of readme.matchAll(/\]\(([^)\s]+)\)/g)) {
		const href = m[1]!.replace(/^\.\//, "");
		if (CHAPTER.test(href) && !chapters.includes(href)) chapters.push(href);
	}
	return chapters;
}

/** One version's section of a CHANGELOG, without its heading; null when the version isn't there. */
export function extractChangelog(text: string, version: string): string | null {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const heading = new RegExp(`^## \\[?${escaped}\\]?(\\s|$)`);
	const start = lines.findIndex((l) => heading.test(l));
	if (start < 0) return null;
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((l) => l.startsWith("## "));
	return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** The anchor id a chapter gets inside the combined document. */
export function chapterAnchor(file: string): string {
	const name = file.replace(/\.md$/, "");
	if (/^[a-z0-9-]+$/.test(name)) return `ch-${name}`;
	const digits = name.match(/^\d+/)?.[0] ?? "";
	const hash = createHash("sha1").update(name).digest("hex").slice(0, 8);
	return `ch-${digits ? `${digits}-` : ""}${hash}`;
}
