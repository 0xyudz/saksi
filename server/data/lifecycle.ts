import { desc, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import {
  memoryWrites,
  payments,
  recommendations,
  signals,
  type MemoryWriteRow,
  type RecommendationRow,
} from "@/db/schema";

export interface PaymentLedgerItem {
  readonly id: string;
  readonly signalId: string;
  readonly digest: string;
  readonly payer: string;
  readonly payTo: string;
  readonly amountAtomic: bigint;
  readonly network: string;
  readonly verifiedAt: Date;
  readonly provider: string;
  readonly signalTitle: string;
}

export async function listRecentPayments(limit = 50): Promise<PaymentLedgerItem[]> {
  const rows = await getDb()
    .select({
      id: payments.id,
      signalId: payments.signalId,
      digest: payments.digest,
      payer: payments.payer,
      payTo: payments.payTo,
      amountAtomic: payments.amountAtomic,
      network: payments.network,
      verifiedAt: payments.verifiedAt,
      provider: signals.provider,
      signalTitle: signals.title,
    })
    .from(payments)
    .innerJoin(signals, eq(signals.id, payments.signalId))
    .orderBy(desc(payments.verifiedAt))
    .limit(limit);

  return rows;
}

export async function listMemoryWriteAudit(limit = 25): Promise<MemoryWriteRow[]> {
  return getDb().select().from(memoryWrites).orderBy(desc(memoryWrites.createdAt)).limit(limit);
}

export async function listRecentRecommendations(limit = 10): Promise<RecommendationRow[]> {
  return getDb()
    .select()
    .from(recommendations)
    .orderBy(desc(recommendations.createdAt))
    .limit(limit);
}

export async function countMemoryWrites(): Promise<number> {
  const rows = await getDb().select({ id: memoryWrites.id }).from(memoryWrites);
  return rows.length;
}
