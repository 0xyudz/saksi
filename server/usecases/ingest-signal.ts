import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db/client";
import { signals, type SignalRow } from "@/db/schema";
import { fetchProviderSignal } from "@/integrations/signals/provider";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { parsePriceToAtomic } from "@/lib/price";

export const ingestSignalSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
});

export type IngestSignalInput = z.infer<typeof ingestSignalSchema>;

export async function ingestSignal(input: IngestSignalInput): Promise<SignalRow> {
  const env = getEnv();
  const priceAtomic = parsePriceToAtomic(env.X402_PRICE);
  const providerSignal = await fetchProviderSignal(input.externalId);

  const rows = await getDb()
    .insert(signals)
    .values({
      externalRef: input.externalId,
      provider: providerSignal.provider,
      title: providerSignal.title,
      payload: providerSignal.payload,
      priceAtomic,
      asset: env.SUI_USDC_COIN_TYPE,
    })
    .onConflictDoUpdate({
      target: [signals.provider, signals.externalRef],
      set: {
        title: providerSignal.title,
        payload: providerSignal.payload,
        priceAtomic,
        asset: env.SUI_USDC_COIN_TYPE,
      },
    })
    .returning();

  const signal = rows[0];
  if (!signal) throw new AppError("INTERNAL", "The signal could not be persisted.");
  return signal;
}

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
