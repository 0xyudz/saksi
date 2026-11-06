import {
  health,
  listMemories,
  recall,
  rememberPreference,
  type MemoryHealth,
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
  readonly health: MemoryHealth;
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

/**
 * Decides whether a relayer that answered `health()` is usable for this app.
 *
 * Pure so the rule is testable without a relayer. `writeReady === null` means the relayer did
 * not report the field at all, which is not evidence of a fault; only an explicit `false` is.
 * This distinction matters because a paused write path fails every pick sealing while reads
 * keep succeeding, so a read-only health check would call that state "ok".
 */
export function relayerUsable(input: {
  readonly reachable: boolean;
  readonly writeReady: boolean | null;
}): { readonly ok: boolean; readonly reason: "unreachable" | "writes_refused" | "ok" } {
  if (!input.reachable) return { ok: false, reason: "unreachable" };
  if (input.writeReady === false) return { ok: false, reason: "writes_refused" };
  return { ok: true, reason: "ok" };
}

export async function memoryHealth(): Promise<{
  status: string;
  version: string;
  writeReady: boolean | null;
}> {
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
