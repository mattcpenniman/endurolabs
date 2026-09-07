// ============================================================
// EnduroLab — Database Client
// ============================================================
// Drizzle ORM client with connection pooling via postgres.
// ============================================================

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Singleton connection — reused across hot-reloads
const globalForDb = globalThis as unknown as {
  conn: postgres.Sql | undefined;
  db: ReturnType<typeof drizzle> | undefined;
};

const conn =
  globalForDb.conn ??
  postgres(process.env.DATABASE_URL!, {
    prepare: false, // required for serverless / edge
  });

const db = globalForDb.db ?? drizzle(conn);

if (process.env.NODE_ENV !== "production") {
  globalForDb.conn = conn;
  globalForDb.db = db;
}

export async function endDb(): Promise<void> {
  await conn.end({ timeout: 5 });
}

export { db };
