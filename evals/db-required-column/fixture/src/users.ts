export interface Db {
	query(sql: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface User {
	id: number;
	email: string;
}

export async function createUser(db: Db, email: string): Promise<User> {
	const { rows } = await db.query("INSERT INTO users (email) VALUES ($1) RETURNING id, email", [email]);
	const row = rows[0];
	return { id: Number(row.id), email: String(row.email) };
}
