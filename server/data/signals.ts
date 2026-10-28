import { count, desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { payments, signals, type SignalRow } from "@/db/schema";

export async function findSignalById(signalId: string): Promise<SignalRow | null> {
  const rows = await getDb().select().from(signals).where(eq(signals.id, signalId)).limit(1);
  return rows[0] ?? null;
}

export interface SignalListItem {
  readonly signal: SignalRow;
  readonly purchases: number;
}

export async function listSignals(limit = 50): Promise<SignalListItem[]> {
  const rows = await getDb()
    .select({
      signal: signals,
      purchases: count(payments.id),
    })
    .from(signals)
    .leftJoin(payments, eq(payments.signalId, signals.id))
    .groupBy(signals.id)
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    signal: row.signal,
    purchases: Number(row.purchases),
  }));
}
