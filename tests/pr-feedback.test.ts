import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, type PrData } from "../lib/pr-feedback.ts";

const human = (login: string) => ({ login, __typename: "User" });
const bot = (login: string) => ({ login, __typename: "Bot" });
type Author = ReturnType<typeof human>;

function thread(id: string, opts: { resolved?: boolean; path?: string; line?: number; last: { id: string; author: Author; body?: string } }) {
	const c = { id: opts.last.id, author: opts.last.author, body: opts.last.body ?? "Please rename this.", url: `https://x/${opts.last.id}`, createdAt: "2026-11-15T10:00:00Z" };
	return { id, isResolved: opts.resolved ?? false, path: opts.path ?? "a.ts", line: opts.line ?? 12, comments: { totalCount: 1, nodes: [c] } };
}
function review(id: string, author: Author, body: string, at: string, state = "COMMENTED") {
	return { id, author, body, state, url: `https://x/${id}`, submittedAt: at };
}
function comment(id: string, author: Author, body: string, at: string) {
	return { id, author, body, url: `https://x/${id}`, createdAt: at };
}
function pr(parts: Partial<Pick<PrData, "reviewThreads" | "reviews" | "latestOpinionatedReviews" | "comments">> = {}): PrData {
	return {
		number: 7,
		url: "https://x/pr/7",
		reviewThreads: { totalCount: parts.reviewThreads?.nodes.length ?? 0, nodes: [] },
		reviews: { totalCount: parts.reviews?.nodes.length ?? 0, nodes: [] },
		latestOpinionatedReviews: { totalCount: parts.latestOpinionatedReviews?.nodes.length ?? 0, nodes: [] },
		comments: { totalCount: parts.comments?.nodes.length ?? 0, nodes: [] },
		...parts,
	};
}
const conn = <T>(nodes: T[], totalCount = nodes.length) => ({ totalCount, nodes });

test("thread: open unless resolved or our login has the last word", () => {
	const r = classify(
		pr({
			reviewThreads: conn([
				thread("T1", { resolved: true, last: { id: "c1", author: human("alice") } }),
				thread("T2", { last: { id: "c2", author: human("me") } }),
				thread("T3", { path: "b.ts", line: 3, last: { id: "c3", author: human("alice") } }),
			]),
		}),
		"me",
	);
	assert.deepEqual(r.open.map((i) => ({ kind: i.kind, author: i.author, path: i.path, line: i.line })), [{ kind: "thread", author: "alice", path: "b.ts", line: 3 }]);
	assert.equal(r.closed, 2);
});

test("thread: a reply after ours re-opens it with a new id", () => {
	const before = classify(pr({ reviewThreads: conn([thread("T1", { last: { id: "c1", author: human("alice") } })]) }), "me");
	const after = classify(pr({ reviewThreads: conn([thread("T1", { last: { id: "c9", author: human("alice") } })]) }), "me");
	assert.equal(before.open[0]?.id, "T1:c1");
	assert.equal(after.open[0]?.id, "T1:c9");
});

test("review body: open until a later comment by us", () => {
	const body = review("R1", bot("coderabbitai"), "Nitpicks: 1. rename x", "2026-11-15T10:00:00Z");
	const earlier = classify(pr({ reviews: conn([body]), comments: conn([comment("I1", human("me"), "ok", "2026-11-15T09:00:00Z")]) }), "me");
	assert.deepEqual(earlier.open.map((i) => [i.kind, i.id, i.author]), [["review", "R1", "coderabbitai"]]);
	const later = classify(pr({ reviews: conn([body]), comments: conn([comment("I1", human("me"), "1. renamed", "2026-11-15T11:00:00Z")]) }), "me");
	assert.equal(later.open.length, 0);
	assert.equal(later.closed, 1);
	const empty = classify(pr({ reviews: conn([review("R2", human("alice"), "  ", "2026-11-15T10:00:00Z")]) }), "me");
	assert.equal(empty.open.length + empty.closed, 0);
	const ours = classify(pr({ reviews: conn([review("R3", human("me"), "self note", "2026-11-15T10:00:00Z")]) }), "me");
	assert.equal(ours.open.length + ours.closed, 0);
});

test("review body: a later review body of ours answers it too", () => {
	const r = classify(
		pr({ reviews: conn([review("R1", human("alice"), "Why sync?", "2026-11-15T10:00:00Z"), review("R2", human("me"), "Because X.", "2026-11-15T11:00:00Z")]) }),
		"me",
	);
	assert.equal(r.open.length, 0);
	assert.equal(r.closed, 1);
});

test("top-level comment: human open, bot never an item", () => {
	const r = classify(
		pr({
			comments: conn([
				comment("I1", bot("vercel"), "Preview deployed", "2026-11-15T10:00:00Z"),
				comment("I2", human("bob"), "Does this handle EUR?", "2026-11-15T10:05:00Z"),
				comment("I3", human("me"), "Will check", "2026-11-15T10:01:00Z"),
			]),
		}),
		"me",
	);
	assert.deepEqual(r.open.map((i) => [i.kind, i.id, i.author]), [["comment", "I2", "bob"]]);
	assert.equal(r.closed, 0);
});

test("changes requested stands until that reviewer reviews again", () => {
	const r = classify(
		pr({
			latestOpinionatedReviews: conn([
				{ id: "R1", author: human("carol"), state: "CHANGES_REQUESTED", url: "https://x/R1" },
				{ id: "R2", author: human("dave"), state: "APPROVED", url: "https://x/R2" },
			]),
			reviews: conn([review("R2", human("dave"), "", "2026-11-15T10:00:00Z", "APPROVED")]),
		}),
		"me",
	);
	assert.deepEqual(r.open.map((i) => [i.kind, i.id, i.author]), [["changes-requested", "changes-requested:carol", "carol"]]);
});

test("ignore drops by author, by pattern, by both", () => {
	const data = pr({
		comments: conn([
			comment("I1", human("sonar-user"), "Quality gate passed", "2026-11-15T10:00:00Z"),
			comment("I2", human("bob"), "/deploy staging", "2026-11-15T10:00:00Z"),
			comment("I3", human("eve"), "/deploy prod", "2026-11-15T10:00:00Z"),
			comment("I4", human("eve"), "Is this safe?", "2026-11-15T10:00:00Z"),
		]),
	});
	const r = classify(data, "me", { ignore: [{ author: "sonar-user" }, { pattern: "^/deploy staging" }, { author: "eve", pattern: "^/deploy" }] });
	assert.deepEqual(r.open.map((i) => i.id), ["I4"]);
	assert.deepEqual(r.problems, []);
});

test("an invalid ignore pattern is a problem and drops nothing", () => {
	const r = classify(pr({ comments: conn([comment("I1", human("bob"), "(", "2026-11-15T10:00:00Z")]) }), "me", { ignore: [{ pattern: "(" }] });
	assert.deepEqual(r.open.map((i) => i.id), ["I1"]);
	assert.deepEqual(r.problems, ['prFeedback.ignore pattern "(" is not a valid regular expression']);
});

test("more than one page is a problem", () => {
	const r = classify(pr({ reviewThreads: conn([thread("T1", { last: { id: "c1", author: human("alice") } })], 140) }), "me");
	assert.deepEqual(r.problems, ["reviewThreads: 1 of 140 read"]);
});

test("excerpt is one line, at most 200 characters", () => {
	const long = `First line\n\nsecond ${"x".repeat(300)}`;
	const [item] = classify(pr({ comments: conn([comment("I1", human("bob"), long, "2026-11-15T10:00:00Z")]) }), "me").open;
	assert.ok(item);
	assert.equal(item.excerpt.length, 200);
	assert.ok(!/\n/.test(item.excerpt));
	assert.ok(item.excerpt.startsWith("First line second x"));
	assert.ok(item.excerpt.endsWith("…"));
});

test("an author GitHub deleted counts as someone else", () => {
	const r = classify(pr({ comments: conn([{ id: "I1", author: null, body: "hm", url: "https://x/I1", createdAt: "2026-11-15T10:00:00Z" }]) }), "me");
	assert.deepEqual(r.open.map((i) => i.author), ["ghost"]);
});
