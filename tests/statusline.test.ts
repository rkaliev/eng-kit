import assert from "node:assert/strict";
import test from "node:test";
import { bar, statusText } from "../lib/statusline.ts";

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
