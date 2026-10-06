import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bar, planStatusLine, stableRoot, statusText } from "../lib/statusline.ts";

const resets = new Date(2026, 9, 6, 14, 20).toISOString();
const full = {
	context_window: { used_percentage: 42 },
	cost: { total_cost_usd: 1.87 },
	rate_limits: { five_hour: { used_percentage: 63, resets_at: resets }, seven_day: { used_percentage: 31 } },
};

test("the status line shows context, cost, plan limits and subagent tokens; missing parts are left out", () => {
	assert.equal(statusText(full, 1_234_567, false), "ctx ▓▓▓▓▓░░░░░ 42% · $1.87 · 5h ▓▓▓▓▓▓▓░░░ 63% ↻14:20 · 7d ▓▓▓▓░░░░░░ 31% · sub 1.2M");
	assert.equal(statusText({ context_window: full.context_window, cost: full.cost }, undefined, false), "ctx ▓▓▓▓▓░░░░░ 42% · $1.87", "an API user has no plan limits; no ledger, no sub");
	assert.equal(statusText("garbage", undefined, false), "eng-kit");
	assert.equal(statusText({}, undefined, false), "eng-kit");
});

test("a bar has a cell per started 10 %, coloured green, yellow from 50 % and red from 80 %; NO_COLOR drops the colour", () => {
	assert.equal(bar(0), "░░░░░░░░░░");
	assert.equal(bar(1), "▓░░░░░░░░░");
	assert.equal(bar(49), "▓▓▓▓▓░░░░░");
	assert.equal(bar(100), "▓▓▓▓▓▓▓▓▓▓");
	const colour = (pct: number) => statusText({ context_window: { used_percentage: pct } }, undefined, true);
	for (const [pct, code] of [[0, 32], [49, 32], [50, 33], [79, 33], [80, 31], [100, 31]] as const) {
		assert.match(colour(pct), new RegExp(`\\x1b\\[${code}m`), `${pct}% is coloured ${code}`);
	}
	assert.doesNotMatch(statusText(full, 1, false), /\x1b\[/);
});

test("the installer adds the status line to user settings, keeps other keys and never replaces someone else's without --force", () => {
	const ours = 'node "/home/u/.claude/plugins/marketplaces/eng-kit/scripts/statusline.ts"';
	const parsed = (plan: ReturnType<typeof planStatusLine>) => JSON.parse(plan.text ?? "null");
	assert.deepEqual(parsed(planStatusLine(undefined, ours, false)), { statusLine: { type: "command", command: ours } });
	assert.equal(planStatusLine(undefined, ours, false).status, "added");
	const withTheme = JSON.stringify({ theme: "dark" });
	assert.deepEqual(parsed(planStatusLine(withTheme, ours, false)), { theme: "dark", statusLine: { type: "command", command: ours } });
	assert.deepEqual(planStatusLine(JSON.stringify({ statusLine: { type: "command", command: ours } }), ours, false), { status: "same" });
	const older = JSON.stringify({ statusLine: { type: "command", command: 'node "/x/plugins/cache/eng-kit/eng-kit/0.21.0/scripts/statusline.ts"' } });
	assert.equal(planStatusLine(older, ours, false).status, "replaced", "an earlier eng-kit status line is updated");
	const theirs = JSON.stringify({ statusLine: { type: "command", command: "~/bin/my-line.sh" }, theme: "dark" });
	assert.deepEqual(planStatusLine(theirs, ours, false), { status: "refused" });
	assert.deepEqual(parsed(planStatusLine(theirs, ours, true)), { statusLine: { type: "command", command: ours }, theme: "dark" });
	assert.deepEqual(planStatusLine("{ not json", ours, true), { status: "invalid" });
});

test("the status line points at the marketplace clone, which survives plugin updates", () => {
	const home = mkdtempSync(join(tmpdir(), "statusline-home-"));
	const cache = join(home, ".claude", "plugins", "cache", "eng-kit", "eng-kit", "0.22.0");
	assert.equal(stableRoot(cache, home), cache, "no clone: keep the given root");
	mkdirSync(join(home, ".claude", "plugins", "marketplaces", "eng-kit"), { recursive: true });
	assert.equal(stableRoot(cache, home), join(home, ".claude", "plugins", "marketplaces", "eng-kit"));
	assert.equal(stableRoot("/work/app/.claude/eng-kit", home), "/work/app/.claude/eng-kit", "a project install keeps its path");
});
