import {
  health,
  listMemories,
  recall,
  rememberPreference,
  type MemoryPage,
  type RememberedMemory,
} from "@/integrations/walrus-memory/client";
import type { MemoryCitation } from "@/lib/domain";

export interface MemoryLedger {
  readonly page: MemoryPage;
  readonly health: { status: string; version: string };
}

export async function memoryLedger(userId: string): Promise<MemoryLedger> {
  const [page, runtime] = await Promise.all([listMemories(userId), health()]);
  return { page, health: runtime };
}

export async function memoryHealth(): Promise<{ status: string; version: string }> {
  return health();
}

export async function recallMemories(
  userId: string,
  query: string,
): Promise<readonly MemoryCitation[]> {
  const result = await recall(userId, query);
  return result.hits.map((hit) => hit.citation);
}

export async function savePreference(userId: string, statement: string): Promise<RememberedMemory> {
  return rememberPreference(userId, statement);
}
