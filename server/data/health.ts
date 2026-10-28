import { sql } from "drizzle-orm";

import { getDb } from "@/db/client";

export async function databaseHealth(): Promise<void> {
  await getDb().execute(sql`select 1`);
}
