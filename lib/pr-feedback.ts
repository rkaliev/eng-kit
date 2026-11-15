/**
 * PR review feedback: which items on a GitHub pull request are still unanswered (the PR feedback gate).
 * Shared byte-for-byte by the Claude Code and pi editions; it imports only Node built-ins.
 */

export type ItemKind = "thread" | "review" | "comment" | "changes-requested";

export interface Item {
	id: string;
	kind: ItemKind;
	author: string;
	path?: string;
	line?: number;
	url: string;
	excerpt: string;
}

export interface FeedbackConfig {
	ignore?: Array<{ author?: string; pattern?: string }>;
}

interface Author {
	login: string;
	__typename?: string;
}
interface Connection<T> {
	totalCount?: number;
	nodes: T[];
}
interface Comment {
	id: string;
	author: Author | null;
	body: string;
	url: string;
	createdAt: string;
}

/** The pull request as the collector's GraphQL query returns it. */
export interface PrData {
	number: number;
	url: string;
	commits?: Connection<{ commit: { oid: string; statusCheckRollup?: { state: string; contexts?: Connection<{ __typename?: string; name?: string; conclusion?: string | null; context?: string; state?: string }> } | null } }>;
	reviewThreads: Connection<{ id: string; isResolved: boolean; path?: string | null; line?: number | null; comments: Connection<Comment> }>;
	reviews: Connection<{ id: string; author: Author | null; body: string; state: string; url: string; submittedAt: string | null }>;
	latestOpinionatedReviews: Connection<{ id: string; author: Author | null; state: string; url: string }>;
	comments: Connection<Comment>;
}

const EXCERPT_MAX = 200;

/** One line, at most `EXCERPT_MAX` characters. */
function excerpt(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX - 1)}…` : line;
}

/** GitHub returns a null author for a deleted account and shows it as "ghost". */
const loginOf = (author: Author | null) => author?.login ?? "ghost";

/**
 * Which feedback items on `pr` are still open for `login` (the authenticated `gh` user, the agent's and the user's
 * shared account). An inline thread is closed when resolved or when `login` wrote its last comment; a review body or
 * a person's top-level comment is closed by a later top-level comment, or review body, by `login`; a reviewer whose
 * latest approving or changes-requesting review asks for changes stays open whatever is answered. Not items: what
 * `login` wrote, empty review bodies, and top-level comments by bots (summaries, coverage, previews: bot findings
 * arrive in review bodies and threads, which count). `config.ignore` drops items by author and/or text pattern.
 */
export function classify(pr: PrData, login: string, config: FeedbackConfig = {}): { open: Item[]; closed: number; problems: string[] } {
	const problems: string[] = [];
	for (const [name, c] of [["reviewThreads", pr.reviewThreads], ["reviews", pr.reviews], ["latestOpinionatedReviews", pr.latestOpinionatedReviews], ["comments", pr.comments]] as const) {
		if ((c.totalCount ?? 0) > c.nodes.length) problems.push(`${name}: ${c.nodes.length} of ${c.totalCount} read`);
	}
	const rules: Array<{ author?: string; pattern?: RegExp }> = [];
	for (const rule of config.ignore ?? []) {
		let pattern: RegExp | undefined;
		if (typeof rule.pattern === "string") {
			try {
				pattern = new RegExp(rule.pattern);
			} catch {
				problems.push(`prFeedback.ignore pattern "${rule.pattern}" is not a valid regular expression`);
				continue;
			}
		}
		const author = typeof rule.author === "string" ? rule.author : undefined;
		if (author !== undefined || pattern) rules.push({ author, pattern });
	}
	const ignored = (author: string, text: string) => rules.some((r) => (r.author === undefined || r.author === author) && (!r.pattern || r.pattern.test(text)));

	// When `login` last answered at the top level: a comment, or a review with a body.
	const ours = [
		...pr.comments.nodes.filter((c) => loginOf(c.author) === login).map((c) => c.createdAt),
		...pr.reviews.nodes.filter((r) => loginOf(r.author) === login && r.body.trim() !== "" && r.submittedAt).map((r) => r.submittedAt as string),
	];
	const answeredAfter = (at: string) => ours.some((t) => t > at);

	const open: Item[] = [];
	let closed = 0;
	const count = (item: Item, text: string, isOpen: boolean) => {
		if (ignored(item.author, text)) return;
		if (isOpen) open.push(item);
		else closed++;
	};
	for (const t of pr.reviewThreads.nodes) {
		const last = t.comments.nodes.at(-1);
		if (!last) continue;
		const author = loginOf(last.author);
		const item: Item = { id: `${t.id}:${last.id}`, kind: "thread", author, url: last.url, excerpt: excerpt(last.body) };
		if (t.path) item.path = t.path;
		if (typeof t.line === "number") item.line = t.line;
		count(item, last.body, !t.isResolved && author !== login);
	}
	for (const r of pr.reviews.nodes) {
		const author = loginOf(r.author);
		if (author === login || r.body.trim() === "" || !r.submittedAt) continue;
		count({ id: r.id, kind: "review", author, url: r.url, excerpt: excerpt(r.body) }, r.body, !answeredAfter(r.submittedAt));
	}
	for (const c of pr.comments.nodes) {
		const author = loginOf(c.author);
		if (author === login || c.author?.__typename === "Bot") continue;
		count({ id: c.id, kind: "comment", author, url: c.url, excerpt: excerpt(c.body) }, c.body, !answeredAfter(c.createdAt));
	}
	for (const r of pr.latestOpinionatedReviews.nodes) {
		const author = loginOf(r.author);
		if (author === login || r.state !== "CHANGES_REQUESTED") continue;
		const item: Item = { id: `changes-requested:${author}`, kind: "changes-requested", author, url: r.url, excerpt: "changes requested" };
		if (!ignored(author, "")) open.push(item);
	}
	return { open, closed, problems };
}
