import {
  health,
  listMemories,
  recall,
  rememberPreference,
  type MemoryPage,
  type RecalledMemoryHit,
  type RememberedMemory,
} from "@/integrations/walrus-memory/client";
import { parseMemory, type MemoryKind } from "@/integrations/walrus-memory/schema";
import type { MemoryCitation } from "@/lib/domain";

export interface MemoryLedgerEntry {
  readonly blobId: string;
  readonly size: number;
  readonly status: string;
  readonly createdAt: string;
  /** The decoded record, or null when the blob is not a valid Saksi memory. */
  readonly memory: ReturnType<typeof parseMemory>;
}

export interface MemoryLedger {
  readonly page: MemoryPage;
  readonly health: { status: string; version: string };
  /** Blob metadata joined with the text `recall()` returns, newest first. */
  readonly entries: ReadonlyArray<MemoryLedgerEntry>;
  /** Distinct memory kinds actually present in this namespace. */
  readonly kinds: ReadonlyArray<MemoryKind>;
}

/**
 * The relayer's `listMemories()` returns metadata only, so the ledger is built from two
 * reads: the metadata (authoritative for count, size and status) and a recall with a
 * neutral query, which is the only call that returns decrypted text.
 *
 * The two are joined on `blobId`. A blob present in the listing but missing from the
 * recall keeps its metadata with `memory: null` rather than being dropped, so the page
 * never hides a memory it could not read.
 */
export async function memoryLedger(userId: string): Promise<MemoryLedger> {
  const [page, runtime, contents] = await Promise.all([
    listMemories(userId),
    health(),
    recall(userId, "saksi memory record", 100),
  ]);

  const textByBlob = new Map(contents.hits.map((hit) => [hit.citation.blobId, hit.citation.text]));

  const entries: MemoryLedgerEntry[] = page.memories
    .map((memory) => {
      const text = textByBlob.get(memory.blobId);
      return {
        blobId: memory.blobId,
        size: memory.size,
        status: memory.status,
        createdAt: memory.createdAt,
        memory: text === undefined ? null : parseMemory(text),
      };
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const kinds = [
    ...new Set(
      entries
        .map((entry) => entry.memory?.kind)
        .filter((kind): kind is MemoryKind => kind !== undefined),
    ),
  ];

  return { page, health: runtime, entries, kinds };
}

export async function memoryHealth(): Promise<{ status: string; version: string }> {
  return health();
}

export async function recallMemories(
  userId: string,
  query: string,
): Promise<readonly RecalledMemoryHit[]> {
  const result = await recall(userId, query);
  return result.hits;
}

export async function savePreference(userId: string, statement: string): Promise<RememberedMemory> {
  return rememberPreference(userId, statement);
}

/** Citations only, for callers that do not need the decoded record. */
export function citationsOf(hits: ReadonlyArray<RecalledMemoryHit>): readonly MemoryCitation[] {
  return hits.map((hit) => hit.citation);
}
