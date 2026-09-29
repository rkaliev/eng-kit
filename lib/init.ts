import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ciCoverage } from "./ci.ts";
import { readProjectJson } from "./config.ts";
import { DEFAULT_IGNORE, resolveVerifyCommands } from "./commands.ts";

export interface InitItem {
	/** Path relative to the project root. */
	target: string;
	/** `missing` = not created here (CLAUDE.md is written by onboarding from the code). */
	status: "exists" | "create" | "merge" | "missing";
	/** Full file content to write for `create` / `merge`. */
	content?: string;
	why: string;
}

export interface InitOptions {
	/** Hook settings to merge (project installs; plugins bring their own hooks). */
	hooks?: Record<string, unknown>;
}

/**
 * Defense in depth next to the guard hook: native deny rules still hold when hooks are
 * disabled. The guard also covers keystores, credentials files and shell access.
 */
export const SECRET_DENY = [
	"Read(**/.env)",
	"Read(**/.env.local)",
	"Read(**/.env.*.local)",
	"Read(**/.env.production)",
	"Read(**/*.pem)",
	"Read(**/*.key)",
	"Read(~/.ssh/**)",
	"Read(~/.aws/credentials)",
];

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/** Everything kit-init would do in `cwd`. Existing files are only ever merged (settings) or left alone. */
export function planInit(cwd: string, options: InitOptions = {}): InitItem[] {
	const has = (rel: string) => existsSync(join(cwd, rel));
	const items: InitItem[] = [];

	if (has(".claude/verify.json")) items.push({ target: ".claude/verify.json", status: "exists", why: "verification commands" });
	else {
		const commands = detectVerifyCommands(cwd);
		items.push({
			target: ".claude/verify.json",
			status: "create",
			content: json({ commands, timeoutSec: 600, ignore: DEFAULT_IGNORE }),
			why:
				commands.length > 0
					? `verification commands: ${commands.join(", ")}`
					: "no test/typecheck/build commands detected; fill in the commands before relying on the verify gate",
		});
	}

	items.push(
		has(".claude/guard.json")
			? { target: ".claude/guard.json", status: "exists", why: "project guard rules" }
			: {
					target: ".claude/guard.json",
					status: "create",
					content: json({ block: [], confirm: [], allow: [], protectedPaths: [] }),
					why: "empty project guard rules to extend (the built-in rules always apply)",
				},
	);

	items.push(planSettings(cwd, options));
	items.push(planCi(cwd, "/eng-kit:ci-quality-gates"));

	if (has("CLAUDE.md")) items.push({ target: "CLAUDE.md", status: "exists", why: "project instructions" });
	else if (has("AGENTS.md"))
		items.push({ target: "CLAUDE.md", status: "create", content: "@AGENTS.md\n", why: "imports the existing AGENTS.md, so both agents share one file" });
	else items.push({ target: "CLAUDE.md", status: "missing", why: "run /onboarding-existing-codebase: it writes CLAUDE.md from the code and proven commands" });
	return items;
}

function planSettings(cwd: string, options: InitOptions): InitItem {
	const target = ".claude/settings.json";
	const additions: Record<string, unknown> = { permissions: { deny: SECRET_DENY } };
	const reasons = ["deny reading .env files and keys"];
	if (options.hooks) {
		additions.hooks = options.hooks;
		reasons.push("register the kit hooks");
	}
	const why = reasons.join("; ");

	const file = join(cwd, target);
	if (!existsSync(file)) return { target, status: "create", content: json(additions), why };
	let settings: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!isObject(parsed)) throw new Error("not an object");
		settings = parsed;
	} catch {
		return { target, status: "exists", why: "settings.json is not valid JSON; left untouched" };
	}
	// Kit hook groups are replaced, not appended to, so an updated hook definition takes over.
	const merged = mergeAdditive(options.hooks ? withoutKitHooks(settings) : settings, additions);
	if (JSON.stringify(merged) === JSON.stringify(settings)) return { target, status: "exists", why: "already configured" };
	return { target, status: "merge", content: json(merged), why };
}

/**
 * Add what is missing, never change what is there: objects merge key by key, arrays gain the
 * items they lack. Hook matcher groups are compared whole, so re-running adds no duplicates.
 */
export function mergeAdditive(base: Record<string, unknown>, add: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(add)) {
		const current = out[key];
		if (current === undefined) out[key] = value;
		else if (isObject(current) && isObject(value)) out[key] = mergeAdditive(current, value);
		else if (Array.isArray(current) && Array.isArray(value)) {
			const seen = new Set(current.map((v) => JSON.stringify(v)));
			out[key] = [...current, ...value.filter((v) => !seen.has(JSON.stringify(v)))];
		}
		// a scalar the user set wins
	}
	return out;
}

const KIT_HOOK = /eng-kit[\\/]hooks[\\/]hook\.ts/;

function withoutKitHooks(settings: Record<string, unknown>): Record<string, unknown> {
	if (!isObject(settings.hooks)) return settings;
	const hooks: Record<string, unknown> = {};
	for (const [event, groups] of Object.entries(settings.hooks)) {
		const kept = Array.isArray(groups) ? groups.filter((g) => !KIT_HOOK.test(JSON.stringify(g))) : groups;
		if (!Array.isArray(kept) || kept.length > 0) hooks[event] = kept;
	}
	return { ...settings, hooks };
}

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Best guess at the project's verification commands, fastest first. */
export function detectVerifyCommands(cwd: string): string[] {
	const fromDocs = resolveVerifyCommands(cwd);
	if ((fromDocs.source === "CLAUDE.md" || fromDocs.source === "AGENTS.md") && fromDocs.commands.length > 0) return fromDocs.commands;

	const has = (rel: string) => existsSync(join(cwd, rel));
	if (has("package.json")) {
		let scripts: Record<string, string> = {};
		try {
			scripts = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).scripts ?? {};
		} catch {
			// unreadable package.json: fall through to other tools
		}
		const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : has("bun.lockb") || has("bun.lock") ? "bun" : "npm";
		const commands: string[] = [];
		for (const name of ["typecheck", "type-check", "lint", "test", "build"]) {
			const body = scripts[name];
			if (!body || /no test specified/.test(body)) continue;
			commands.push(name === "test" && pm !== "bun" ? `${pm} test` : `${pm} run ${name}`);
		}
		if (commands.length > 0) return commands;
	}
	if (has("gradlew")) return ["./gradlew check"];
	if (has("Cargo.toml")) return ["cargo test"];
	if (has("go.mod")) return ["go vet ./...", "go test ./..."];
	if (safeList(cwd).some((f) => f.endsWith(".sln") || f.endsWith(".csproj"))) return ["dotnet test"];
	if (has("pyproject.toml") || has("pytest.ini")) return ["pytest"];
	if (has("Makefile") && /^test:/m.test(readFileSync(join(cwd, "Makefile"), "utf8"))) return ["make test"];
	return [];
}

function safeList(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

/** CI is the second line of defence: it must run at least the verification commands. Reported, never written here. */
function planCi(cwd: string, hint: string): InitItem {
	const configured = resolveVerifyCommands(cwd).commands;
	const commands = configured.length > 0 ? configured : detectVerifyCommands(cwd);
	const { files, missing, workDocsCheck } = ciCoverage(cwd, commands);
	if (files.length === 0) return { target: "CI", status: "missing", why: `no CI configuration found; run ${hint} to set up checks that don't depend on an agent session` };
	const guard = readProjectJson<{ workDocs: string[] }>(cwd, "guard");
	const wantsDocsCheck = !(Array.isArray(guard.workDocs) && guard.workDocs.length === 0);
	const gaps = [
		...(missing.length > 0 ? [`doesn't run: ${missing.join(", ")}`] : []),
		...(wantsDocsCheck && !workDocsCheck ? ["has no working-docs check (specs and plans must not reach the base branch)"] : []),
	];
	if (gaps.length > 0) return { target: "CI", status: "missing", why: `${files.join(", ")} ${gaps.join("; ")}; run ${hint}` };
	return { target: "CI", status: "exists", why: `${files.join(", ")} runs every verification command${wantsDocsCheck ? " and the working-docs check" : ""}` };
}
