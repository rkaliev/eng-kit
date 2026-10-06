/**
 * The eng-kit status line for Claude Code: context use, session cost, plan limits and the branch's subagent tokens.
 * Claude Code passes the session as JSON on stdin; a field it leaves out (API users have no plan limits) is left out.
 */
import { formatTokens } from "./usage.ts";

const CELLS = 10;

/** One cell per started 10 %: 1 % shows one cell, 0 % none. */
export function bar(pct: number): string {
	const filled = Math.min(CELLS, Math.max(0, Math.ceil(pct / (100 / CELLS))));
	return "▓".repeat(filled) + "░".repeat(CELLS - filled);
}

export function statusText(input: unknown, sub: number | undefined, color: boolean): string {
	const data = typeof input === "object" && input !== null ? (input as Record<string, any>) : {};
	const parts: string[] = [];
	const gauge = (label: string, pct: unknown, resets?: unknown) => {
		if (typeof pct !== "number" || !Number.isFinite(pct)) return;
		const rounded = Math.round(pct);
		const text = `${bar(rounded)} ${rounded}%`;
		// Green below 50 %, yellow from 50 %, red from 80 %.
		const code = rounded >= 80 ? 31 : rounded >= 50 ? 33 : 32;
		const time = clock(resets);
		parts.push(`${label} ${color ? `\x1b[${code}m${text}\x1b[0m` : text}${time ? ` ↻${time}` : ""}`);
	};
	gauge("ctx", data.context_window?.used_percentage);
	const cost = data.cost?.total_cost_usd;
	if (typeof cost === "number" && Number.isFinite(cost)) parts.push(`$${cost.toFixed(2)}`);
	gauge("5h", data.rate_limits?.five_hour?.used_percentage, data.rate_limits?.five_hour?.resets_at);
	gauge("7d", data.rate_limits?.seven_day?.used_percentage);
	if (sub !== undefined && sub > 0) parts.push(`sub ${formatTokens(sub)}`);
	return parts.length > 0 ? parts.join(" · ") : "eng-kit";
}

/** Local `HH:MM` of an ISO time or epoch seconds or milliseconds; undefined when it isn't a time. */
function clock(value: unknown): string | undefined {
	const date = typeof value === "number" ? new Date(value < 1e12 ? value * 1000 : value) : typeof value === "string" ? new Date(value) : undefined;
	if (!date || Number.isNaN(date.getTime())) return undefined;
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
