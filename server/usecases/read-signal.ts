import { and, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { signals, type SignalRow } from "@/db/schema";
import { AppError } from "@/lib/errors";

/**
 * Signal reads.
 *
 * Signals are no longer pulled from a configured provider by an operator: they are
 * published by sellers, who set their own price and are paid directly. This module keeps
 * only the lookups the purchase and payment paths need.
 */

export async function getSignal(signalId: string): Promise<SignalRow> {
  const rows = await getDb().select().from(signals).where(eq(signals.id, signalId)).limit(1);
  const signal = rows[0];
  if (!signal) throw new AppError("NOT_FOUND", "Signal not found.");
  return signal;
}

export async function findSignalByExternalRef(
  provider: string,
  externalRef: string,
): Promise<SignalRow | null> {
  const rows = await getDb()
    .select()
    .from(signals)
    .where(and(eq(signals.provider, provider), eq(signals.externalRef, externalRef)))
    .limit(1);
  return rows[0] ?? null;
}
