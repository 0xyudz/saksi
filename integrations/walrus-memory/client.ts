import { MemWal } from "@mysten-incubation/memwal";

import type { MemoryCitation } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { oldestJournalRecord, recoveryNamespace, walletNamespace } from "@/lib/journal-identity";
import {
  buildJournalMemory,
  buildPreferenceMemory,
  buildRecoveryMemory,
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
  /** True when the relayer's cursor went stale and the walk restarted from the beginning. */
  readonly resynced: boolean;
  /** True when a stale cursor could not be recovered, so the walk stopped early. */
  readonly stalled: boolean;
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

/**
 * The namespace for a journal.
 *
 * The ref is a Sui address for journals created after identity moved to the wallet, and a
 * uuid for journals created before. Both are accepted so old memories stay readable where
 * they already are: Walrus is append-only, so rewriting them would mean duplicating every
 * record under a new name and leaving the originals behind anyway.
 */
export function userNamespace(ref: string): string {
  return namespaceFor(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, ref);
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
export async function remember(ref: string, memory: BuiltMemory): Promise<RememberedMemory> {
  const namespace = userNamespace(ref);
  const result = await getMemoryClient().rememberAndWait(memory.text, namespace);

  return {
    id: result.id,
    jobId: result.job_id ?? result.id,
    blobId: result.blob_id,
    namespace,
  };
}

/**
 * Writes the journal's identity record into its wallet-keyed namespace.
 *
 * This is what replaces the deleted `users` row: the handle and the journal ref live here,
 * keyed by wallet, so `login` is an exact lookup instead of a similarity search. It is
 * written once, at creation.
 */
export async function rememberJournal(input: {
  ref: string;
  wallet: string;
  handle: string;
  createdAt: string;
}): Promise<RememberedMemory> {
  const namespace = walletNamespace(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, input.wallet);
  const result = await getMemoryClient().rememberAndWait(buildJournalMemory(input).text, namespace);

  return {
    id: result.id,
    jobId: result.job_id ?? result.id,
    blobId: result.blob_id,
    namespace,
  };
}

/**
 * Reads a journal's identity record by wallet, or null when that wallet has no journal.
 *
 * The namespace *should* hold exactly one record, and `claimJournal` now refuses a second
 * claim so that stays true. It did not always: a wallet could be claimed twice, and this
 * namespace then holds two records pointing at different refs. Picking whichever the relayer
 * happened to rank first would move the journal between namespaces between requests, so the
 * oldest record wins — the journal was created then, and later records are duplicates.
 *
 * `createdAt` is an ISO-8601 timestamp, so string comparison is chronological.
 */
export async function readJournalRecord(wallet: string): Promise<{
  ref: string;
  wallet: string;
  handle: string;
  createdAt: string;
} | null> {
  const namespace = walletNamespace(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, wallet);
  const { hits } = await recallNamespace(namespace, "journal identity handle", 20);

  const records = hits
    .map((hit) => hit.memory)
    .filter(
      (memory): memory is Extract<NonNullable<typeof memory>, { kind: "journal" }> =>
        memory !== null && memory.kind === "journal",
    );

  const oldest = oldestJournalRecord(records);
  if (oldest === null) return null;
  return {
    ref: oldest.ref,
    wallet: oldest.wallet,
    handle: oldest.handle,
    createdAt: oldest.createdAt,
  };
}

/**
 * Writes the recovery pointer: `saksi:recovery:<sha256(code)>` holds the journal it unlocks.
 *
 * The code carries 120 bits of entropy, so publishing the digest of it reveals nothing
 * usable. This is how recovery works without a table — the code itself is the lookup key,
 * and the relayer does the exact-key lookup.
 */
export async function rememberRecovery(input: {
  code: string;
  ref: string;
  wallet: string;
  handle: string;
  createdAt: string;
}): Promise<RememberedMemory> {
  const namespace = recoveryNamespace(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, input.code);
  const result = await getMemoryClient().rememberAndWait(
    buildRecoveryMemory(input).text,
    namespace,
  );

  return {
    id: result.id,
    jobId: result.job_id ?? result.id,
    blobId: result.blob_id,
    namespace,
  };
}

/** Reads the journal pointer stored under a recovery code, or null when the code is unused. */
export async function readRecoveryPointer(code: string): Promise<{
  ref: string;
  wallet: string;
  handle: string;
} | null> {
  const namespace = recoveryNamespace(getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX, code);
  const { hits } = await recallNamespace(namespace, "recovery journal wallet", 10);

  for (const hit of hits) {
    if (hit.memory?.kind === "recovery") {
      return { ref: hit.memory.ref, wallet: hit.memory.wallet, handle: hit.memory.handle };
    }
  }
  return null;
}

export async function rememberPreference(
  ref: string,
  statement: string,
): Promise<RememberedMemory> {
  return remember(ref, buildPreferenceMemory({ userId: ref, statement }));
}

export async function recall(
  ref: string,
  query: string,
  limit = getEnv().WALRUS_RECALL_LIMIT,
): Promise<{ hits: RecalledMemoryHit[] }> {
  return recallNamespace(userNamespace(ref), query, limit);
}

/**
 * Reads a namespace by name rather than by owning journal.
 *
 * Walrus Memory namespaces are readable by any account holding a delegate key for the
 * relayer, which is what lets the app reconstruct a journal from blobs alone instead of
 * from a local table. Callers pass `userNamespace(ref)` when they mean "mine".
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

/**
 * Decides what to do after one `listMemories()` page.
 *
 * Extracted so the stale-cursor rule is unit tested without a relayer. `must_resync` means the
 * relayer can no longer continue from the cursor it handed out, and the documented recovery is
 * to restart the walk without one. Ignoring it would return a short page that looks complete.
 *
 * `alreadyResynced` bounds the retry to one restart: if the relayer reports `must_resync` again
 * with no cursor set, restarting cannot help and the walk has to stop rather than loop.
 */
export function nextListStep(input: {
  mustResync: boolean;
  cursor: string | undefined;
  alreadyResynced: boolean;
  nextCursor: string | null;
  hasMore: boolean;
}): { cursor: string | undefined; hasMore: boolean; resynced: boolean; stalled: boolean } {
  if (input.mustResync && input.cursor !== undefined && !input.alreadyResynced) {
    return { cursor: undefined, hasMore: true, resynced: true, stalled: false };
  }
  if (input.mustResync && (input.cursor === undefined || input.alreadyResynced)) {
    return { cursor: input.cursor, hasMore: false, resynced: false, stalled: true };
  }
  return {
    cursor: input.nextCursor ?? undefined,
    hasMore: input.hasMore,
    resynced: false,
    stalled: false,
  };
}

export async function listMemories(ref: string, pageSize = 100): Promise<MemoryPage> {
  const namespace = userNamespace(ref);
  const memwal = getMemoryClient();

  let cursor: string | undefined;
  let hasMore = true;
  let pages = 0;
  let truncated = false;
  let resynced = false;
  let stalled = false;
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

    const step = nextListStep({
      mustResync: page.must_resync,
      cursor,
      alreadyResynced: resynced,
      nextCursor: page.next_cursor,
      hasMore: page.has_more,
    });

    if (step.resynced) resynced = true;
    if (step.stalled) stalled = true;
    cursor = step.cursor;
    hasMore = step.hasMore;
    pages += 1;
  }

  return { memories, fetched: memories.length, hasMore, truncated, resynced, stalled };
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
