/**
 * Builds a standalone HTML file and a PDF from the repo's Markdown, for readers outside the repo.
 */

import { createHash } from "node:crypto";
import { basename, dirname, relative, resolve } from "node:path";

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

export type LinkOptions = { from: string; chapters: Map<string, string>; repoDir: string; repoUrl?: string };

/**
 * Makes a source's links work in a standalone document: chapter links become in-document anchors,
 * links into the repo are reported (or rewritten to `repoUrl`), and local images move to `assets/`.
 */
export function rewriteLinks(md: string, o: LinkOptions): { text: string; outside: string[]; images: string[] } {
	const outside: string[] = [];
	const images: string[] = [];
	const fromRel = toPosix(relative(o.repoDir, o.from));
	const rewrite = (prose: string) =>
		prose.replace(/(!?)\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))\)/g, (whole, bang: string, label: string, angled?: string, bare?: string) => {
			const href = (angled ?? bare)!;
			if (/^[a-z][a-z0-9+.-]*:|^#|^\/\//i.test(href)) return whole;
			const [, path, rest] = href.match(/^([^?#]*)(.*)$/)!;
			const target = path!.startsWith("/") ? resolve(o.repoDir, `.${path}`) : resolve(dirname(o.from), path!);
			if (bang) {
				images.push(target);
				return `![${label}](<assets/${images.length}-${basename(target)}>)`;
			}
			const anchor = o.chapters.get(target);
			if (anchor) return `[${label}](#${anchor})`;
			if (o.repoUrl) return `[${label}](${o.repoUrl.replace(/\/$/, "")}/${toPosix(relative(o.repoDir, target))}${rest})`;
			outside.push(`${fromRel}: ${href}`);
			return whole;
		});
	// Links inside fenced code blocks and inline code are examples, not links.
	const text = md
		.split(/(^```[^\n]*\n[\s\S]*?^```[ \t]*$)/m)
		.map((part, i) => (i % 2 ? part : part.split(/(`[^`\n]*`)/).map((p, j) => (j % 2 ? p : rewrite(p))).join("")))
		.join("");
	return { text, outside, images };
}

function toPosix(p: string): string {
	return p.split("\\").join("/");
}
