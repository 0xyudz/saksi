import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { getEnv } from "@/lib/env";
import * as schema from "./schema";

type Sql = ReturnType<typeof postgres>;

let sql: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (database) return database;

  const env = getEnv();
  sql = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => undefined,
  });
  database = drizzle(sql, { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (!sql) return;
  await sql.end({ timeout: 5 });
  sql = undefined;
  database = undefined;
}
