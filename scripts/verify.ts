/**
 * Run the project's verification commands (.claude/verify.json, else the Commands section of
 * CLAUDE.md or AGENTS.md) and print PASS/FAIL with the failing output tail.
 * Exits 0 only when every command passed; the verify gate counts that run as green.
 *
 *   node <kit>/scripts/verify.ts [project-dir]
 */
import { resolve } from "node:path";
import { runVerification } from "../lib/verify-run.ts";

const cwd = resolve(process.argv[2] ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const { ok, report } = runVerification(cwd);
process.stdout.write(`${report}\n`);
process.exit(ok ? 0 : 1);
