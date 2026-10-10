import assert from "node:assert/strict";
import test from "node:test";
import { createUser, type Db } from "./users.ts";

function fakeDb(): Db & { calls: { sql: string; params: unknown[] }[] } {
	const calls: { sql: string; params: unknown[] }[] = [];
	return {
		calls,
		async query(sql, params) {
			calls.push({ sql, params });
			return { rows: [{ id: 1, email: params[0] }] };
		},
	};
}

test("createUser inserts the email and returns the new user", async () => {
	const db = fakeDb();
	assert.deepEqual(await createUser(db, "a@example.com"), { id: 1, email: "a@example.com" });
	assert.deepEqual(db.calls[0].params, ["a@example.com"]);
});
