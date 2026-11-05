import { MemWal } from "@mysten-incubation/memwal";

import type { MemoryCitation } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import {
  buildPreferenceMemory,
  namespaceFor,
  parseMemory,
  type BuiltMemory,
  type ParsedMemory,
} from "./schema";

export interface RememberedMemory {
  readonly id: string;
  readonly jobId: string;
  readonly blobId: string;
  readonly namespace: string;
}

export interface MemoryPage {
  readonly memories: ReadonlyArray<{
    readonly memoryId: string;
    readonly blobId: string;
    readonly createdAt: string;
    readonly size: number;
    readonly status: string;
  }>;
  /** Number of memories actually fetched; not a claim about the namespace total. */
  readonly fetched: number;
  /** Whether the relayer had another page after the last page read. */
  readonly hasMore: boolean;
  /** True when the 50-page safety cap stopped a namespace that still had more. */
  readonly truncated: boolean;
}

export interface RecalledMemoryHit {
  readonly citation: MemoryCitation;
  /** Null when the blob text is not a valid Saksi memory record. */
  readonly memory: ParsedMemory | null;
}

let client: MemWal | undefined;

export function getMemoryClient(): MemWal {
  if (client) return client;

  const env = getEnv();
  client = MemWal.create({
    key: env.WALRUS_MEMORY_PRIVATE_KEY,
    accountId: env.WALRUS_MEMORY_ACCOUNT_ID,
    serverUrl: env.WALRUS_MEMORY_RELAYER_URL,
    namespace: env.WALRUS_MEMORY_NAMESPACE_PREFIX,
  });
  return client;
}

export function userNamespace(userId: string): string {
  return namespaceFor(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, userId);
}

export async function health(): Promise<{ status: string; version: string }> {
  const result = await getMemoryClient().health();
  return { status: result.status, version: result.version };
}

/**
 * Writes a validated memory and returns the real blob/job ids.
 *
 * Walrus is the record. There is deliberately no local audit table: a Postgres row
 * describing a Walrus write would be a second copy of something the relayer already
 * returns, and a stale copy at that. The blob id in the returned value is the receipt.
 */
export async function remember(userId: string, memory: BuiltMemory): Promise<RememberedMemory> {
  const namespace = userNamespace(userId);
  const result = await getMemoryClient().rememberAndWait(memory.text, namespace);

  return {
    id: result.id,
    jobId: result.job_id ?? result.id,
    blobId: result.blob_id,
    namespace,
  };
}

export async function rememberPreference(
  userId: string,
  statement: string,
): Promise<RememberedMemory> {
  return remember(userId, buildPreferenceMemory({ userId, statement }));
}

export async function recall(
  userId: string,
  query: string,
  limit = getEnv().WALRUS_RECALL_LIMIT,
): Promise<{ hits: RecalledMemoryHit[] }> {
  return recallNamespace(userNamespace(userId), query, limit);
}

/**
 * Reads a namespace by name rather than by owning user id.
 *
 * Walrus Memory namespaces are readable by any account holding a delegate key for the
 * relayer, which is what lets the app reconstruct a journal from blobs alone instead of
 * from a local table. Callers pass `userNamespace(userId)` when they mean "mine".
 */
export async function recallNamespace(
  namespace: string,
  query: string,
  limit = getEnv().WALRUS_RECALL_LIMIT,
): Promise<{ hits: RecalledMemoryHit[] }> {
  const result = await getMemoryClient().recall({
    query,
    limit,
    namespace,
    sort: "relevance",
  });

  const hits: RecalledMemoryHit[] = result.results.map((hit) => ({
    citation: {
      blobId: hit.blob_id,
      text: hit.text,
      distance: hit.distance,
      ...(hit.created_at === undefined ? {} : { createdAt: hit.created_at }),
    },
    memory: parseMemory(hit.text),
  }));

  return { hits };
}

/** Namespace listing, used to enumerate journals and rebuild state from Walrus alone. */
export async function listNamespaces(): Promise<
  ReadonlyArray<{ name: string; memoryCount: number; storageUsed: number }>
> {
  const memwal = getMemoryClient();
  const namespaces: Array<{ name: string; memoryCount: number; storageUsed: number }> = [];

  let cursor: string | undefined;
  let hasMore = true;
  let pages = 0;

  while (hasMore) {
    if (pages >= 20) break;
    const page = await memwal.listNamespaces({ cursor, limit: 500 });
    for (const entry of page.namespaces) {
      namespaces.push({
        name: entry.name,
        memoryCount: entry.memory_count,
        storageUsed: entry.storage_used,
      });
    }
    cursor = page.next_cursor ?? undefined;
    hasMore = page.has_more;
    pages += 1;
  }

  return namespaces;
}

export async function listMemories(userId: string, pageSize = 100): Promise<MemoryPage> {
  const namespace = userNamespace(userId);
  const memwal = getMemoryClient();

  let cursor: string | undefined;
  let hasMore = true;
  let pages = 0;
  let truncated = false;
  const memories: MemoryPage["memories"][number][] = [];

  while (hasMore) {
    if (pages >= 50) {
      truncated = true;
      break;
    }

    const page = await memwal.listMemories({ namespace, cursor, limit: pageSize });
    for (const memory of page.memories) {
      memories.push({
        memoryId: memory.memory_id,
        blobId: memory.blob_id,
        createdAt: memory.created_at,
        size: memory.size,
        status: memory.status,
      });
    }
    cursor = page.next_cursor ?? undefined;
    hasMore = page.has_more;
    pages += 1;
  }

  return { memories, fetched: memories.length, hasMore, truncated };
}

export async function assertMemoryReachable(): Promise<void> {
  try {
    await health();
  } catch (error) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "Walrus Memory relayer is not reachable.", {
      cause: error,
    });
  }
}
