import { and, eq, isNotNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { outcomes, payments, picks, signals, type PaymentRow } from "@/db/schema";

export interface SourceRoi {
  readonly provider: string;
  readonly spendAtomic: bigint;
  readonly correct: number;
  readonly wrong: number;
  readonly resolved: number;
  readonly roi: number;
}

export async function sourceRoi(provider: string, journalRef?: string): Promise<SourceRoi> {
  const filter = [
    eq(signals.provider, provider),
    ...(journalRef === undefined ? [] : [eq(payments.journalRef, journalRef)]),
  ];
  const rows = await getDb()
    .select({
      amountAtomic: payments.amountAtomic,
      result: outcomes.result,
    })
    .from(payments)
    .innerJoin(signals, eq(signals.id, payments.signalId))
    .leftJoin(picks, eq(picks.id, payments.pickId))
    .leftJoin(outcomes, and(eq(outcomes.pickId, picks.id), isNotNull(outcomes.pickId)))
    .where(and(...filter));

  let spendAtomic = 0n;
  let correct = 0;
  let wrong = 0;

  for (const row of rows) {
    spendAtomic += row.amountAtomic;
    if (row.result === "win") correct += 1;
    if (row.result === "loss") wrong += 1;
  }

  const resolved = correct + wrong;
  const roi = resolved === 0 ? 0 : (correct - wrong) / resolved;

  return { provider, spendAtomic, correct, wrong, resolved, roi };
}

export async function providersForPick(pickId: string): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ provider: signals.provider })
    .from(payments)
    .innerJoin(signals, eq(signals.id, payments.signalId))
    .where(eq(payments.pickId, pickId));
  return rows.map((row) => row.provider);
}

export async function paymentExistsForPick(pickId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.pickId, pickId))
    .limit(1);
  return rows.length > 0;
}

export async function getPaymentByDigest(digest: string): Promise<PaymentRow | null> {
  const rows = await getDb().select().from(payments).where(eq(payments.digest, digest)).limit(1);
  return rows[0] ?? null;
}
