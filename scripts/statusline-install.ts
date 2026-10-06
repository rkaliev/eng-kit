/**
 * Sets the eng-kit status line in the user's Claude Code settings (a plugin can't set one itself).
 *
 *   node <kit>/scripts/statusline-install.ts [--dry-run] [--force]
 *
 * Prints the change first. Someone else's status line is replaced only with --force; other settings are kept.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { planStatusLine, stableRoot } from "../lib/statusline.ts";

const args = new Set(process.argv.slice(2));
const home = homedir();
const settingsPath = join(process.env.CLAUDE_CONFIG_DIR || join(home, ".claude"), "settings.json");
const root = stableRoot(resolve(import.meta.dirname, ".."), home);
const command = `node "${join(root, "scripts", "statusline.ts")}"`;
const plan = planStatusLine(existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : undefined, command, args.has("--force"));

switch (plan.status) {
	case "same":
		console.log(`${settingsPath} already uses the eng-kit status line.`);
		break;
	case "invalid":
		console.error(`${settingsPath} is not a JSON object; left untouched.`);
		process.exit(1);
		break;
	case "refused":
		console.error(`${settingsPath} already has another statusLine; left untouched. Re-run with --force to replace it.`);
		process.exit(1);
		break;
	default:
		console.log(`${plan.status === "added" ? "Adding" : "Replacing"} statusLine in ${settingsPath}:\n  "statusLine": { "type": "command", "command": ${JSON.stringify(command)} }`);
		if (args.has("--dry-run")) break;
		mkdirSync(dirname(settingsPath), { recursive: true });
		writeFileSync(settingsPath, plan.text!);
		console.log("Done. The status line appears with the next message.");
}
