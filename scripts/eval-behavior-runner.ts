/**
 * Child process of eval-behavior.ts: imports a case's behavior check and one run's final file, runs the
 * check and prints its violations as a JSON array. Kept alive by a timer, so a check that never settles
 * is ended by the parent's timeout instead of exiting early.
 *
 *   node scripts/eval-behavior-runner.ts <behavior.ts> <file>
 */
import { pathToFileURL } from "node:url";

const [behaviorPath, filePath] = process.argv.slice(2);
const keepAlive = setInterval(() => {}, 1 << 30);
try {
	const behavior = (await import(pathToFileURL(behaviorPath!).href)).default as { check(mod: Record<string, unknown>): Promise<string[]> };
	const mod = (await import(pathToFileURL(filePath!).href)) as Record<string, unknown>;
	process.stdout.write(JSON.stringify(await behavior.check(mod)));
} finally {
	clearInterval(keepAlive);
}
