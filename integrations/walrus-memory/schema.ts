import { z } from "zod";

import { MEMORY_FORMAT_PREFIX } from "@/lib/config";

/**
 * Walrus Memory stores plain text. Saksi uses one deterministic, single-line format
 * so a memory can be validated, parsed and cited later:
 *
 *   saksi:v1|type=pick_commit|id=<uuid>|analyst=<id>|market=<market>|commitmentHash=<hash>|committedAt=<iso>
 *   saksi:v1|type=pick_reveal|id=<uuid>|selection=<selection>|odds=<odds>|revealedAt=<iso>
 *
 * `type=pick` is read-only legacy data from before the commit/reveal split. New writes
 * never use it. `|`, `%` and newlines are percent-escaped inside values. Builders
 * validate the text they produce, so an invalid memory cannot reach the relayer.
 */

export const MEMORY_KINDS = [
  "pick",
  "pick_commit",
  "pick_reveal",
  "outcome",
  "bias",
  "source_roi",
  "preference",
  "payment",
] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: "expected an ISO-8601 timestamp",
});

const decimalString = z.string().regex(/^\d+$/, "expected a non-negative integer string");

const caip2 = z.string().regex(/^[a-z0-9-]+:[a-zA-Z0-9-]+$/, "expected a CAIP-2 network id");

const base64ish = z.string().min(1).max(200);

const pickSchema = z.strictObject({
  id: z.string().uuid(),
  analyst: z.string().uuid(),
  market: z.string().min(1).max(200),
  selection: z.string().min(1).max(200),
  odds: z.coerce.number().gt(1).max(1000),
  committedAt: isoDate,
});

const pickCommitSchema = z.strictObject({
  id: z.string().uuid(),
  analyst: z.string().uuid(),
  market: z.string().min(1).max(200),
  commitmentHash: z.string().regex(/^[a-f0-9]{64}$/, "expected a SHA-256 hex digest"),
  committedAt: isoDate,
});

const pickRevealSchema = z.strictObject({
  id: z.string().uuid(),
  selection: z.string().min(1).max(200),
  odds: z.coerce.number().gt(1).max(1000),
  revealedAt: isoDate,
});

const outcomeSchema = z.strictObject({
  pickId: z.string().uuid(),
  result: z.enum(["win", "loss", "void"]),
  brier: z.coerce.number().min(0).max(1).optional(),
  source: z.string().url(),
  resolvedAt: isoDate,
});

const biasSchema = z.strictObject({
  analyst: z.string().uuid(),
  pattern: z.string().min(1).max(400),
  evidence: z.coerce.number().int().min(1).max(10_000),
  confidence: z.coerce.number().min(0).max(1),
});

const sourceRoiSchema = z.strictObject({
  provider: z.string().min(1).max(120),
  spendAtomic: decimalString,
  correct: z.coerce.number().int().min(0),
  wrong: z.coerce.number().int().min(0),
  note: z.string().max(400).optional(),
});

const preferenceSchema = z.strictObject({
  userId: z.string().uuid(),
  statement: z.string().min(1).max(400),
});

const paymentSchema = z.strictObject({
  digest: base64ish,
  provider: z.string().min(1).max(120),
  amountAtomic: decimalString,
  network: caip2,
});

type ParsedBase =
  | ({ readonly kind: "pick" } & z.infer<typeof pickSchema>)
  | ({ readonly kind: "pick_commit" } & z.infer<typeof pickCommitSchema>)
  | ({ readonly kind: "pick_reveal" } & z.infer<typeof pickRevealSchema>)
  | ({ readonly kind: "outcome" } & z.infer<typeof outcomeSchema>)
  | ({ readonly kind: "bias" } & z.infer<typeof biasSchema>)
  | ({ readonly kind: "source_roi" } & z.infer<typeof sourceRoiSchema>)
  | ({ readonly kind: "preference" } & z.infer<typeof preferenceSchema>)
  | ({ readonly kind: "payment" } & z.infer<typeof paymentSchema>);

export type ParsedMemory = ParsedBase & { readonly text: string };

export interface BuiltMemory {
  readonly kind: MemoryKind;
  readonly text: string;
}

function escapeValue(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("|", "%7C")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .trim();
}

function unescapeValue(value: string): string {
  return value.replaceAll("%7C", "|").replaceAll("%25", "%");
}

function assemble(kind: MemoryKind, pairs: ReadonlyArray<readonly [string, string]>): BuiltMemory {
  const text = [
    MEMORY_FORMAT_PREFIX,
    `type=${kind}`,
    ...pairs.map(([key, value]) => `${key}=${escapeValue(value)}`),
  ].join("|");

  const parsed = parseMemory(text);
  if (!parsed || parsed.kind !== kind) {
    throw new Error(`Memory validator rejected a freshly built ${kind} record`);
  }

  return { kind, text };
}

export function parseMemory(text: string): ParsedMemory | null {
  const segments = text.trim().split("|");
  const [prefix, typeSegment, ...rest] = segments;

  if (prefix !== MEMORY_FORMAT_PREFIX || typeSegment === undefined) return null;
  if (!typeSegment.startsWith("type=")) return null;

  const type = typeSegment.slice("type=".length);
  if (!isMemoryKind(type)) return null;

  const fields: Record<string, string> = {};
  for (const segment of rest) {
    const separator = segment.indexOf("=");
    if (separator <= 0) return null;
    const key = segment.slice(0, separator);
    const value = segment.slice(separator + 1);
    if (key in fields) return null;
    fields[key] = unescapeValue(value);
  }

  const parsed = parseFields(type, fields);
  return parsed === null ? null : { ...parsed, text: text.trim() };
}

function parseFields(kind: MemoryKind, fields: Record<string, string>): ParsedBase | null {
  switch (kind) {
    case "pick": {
      const result = pickSchema.safeParse(fields);
      return result.success ? { kind: "pick", ...result.data } : null;
    }
    case "pick_commit": {
      const result = pickCommitSchema.safeParse(fields);
      return result.success ? { kind: "pick_commit", ...result.data } : null;
    }
    case "pick_reveal": {
      const result = pickRevealSchema.safeParse(fields);
      return result.success ? { kind: "pick_reveal", ...result.data } : null;
    }
    case "outcome": {
      const result = outcomeSchema.safeParse(fields);
      return result.success ? { kind: "outcome", ...result.data } : null;
    }
    case "bias": {
      const result = biasSchema.safeParse(fields);
      return result.success ? { kind: "bias", ...result.data } : null;
    }
    case "source_roi": {
      const result = sourceRoiSchema.safeParse(fields);
      return result.success ? { kind: "source_roi", ...result.data } : null;
    }
    case "preference": {
      const result = preferenceSchema.safeParse(fields);
      return result.success ? { kind: "preference", ...result.data } : null;
    }
    case "payment": {
      const result = paymentSchema.safeParse(fields);
      return result.success ? { kind: "payment", ...result.data } : null;
    }
    default:
      return null;
  }
}

export function isMemoryKind(value: string): value is MemoryKind {
  return (MEMORY_KINDS as readonly string[]).includes(value);
}

export function memoryKind(text: string): MemoryKind | null {
  return parseMemory(text)?.kind ?? null;
}

/** Legacy builder kept only so old test fixtures can round-trip. Runtime never writes it. */
export function buildPickMemory(input: z.infer<typeof pickSchema>): BuiltMemory {
  return assemble("pick", [
    ["id", input.id],
    ["analyst", input.analyst],
    ["market", input.market],
    ["selection", input.selection],
    ["odds", input.odds.toString()],
    ["committedAt", input.committedAt],
  ]);
}

export function buildPickCommitMemory(input: z.infer<typeof pickCommitSchema>): BuiltMemory {
  return assemble("pick_commit", [
    ["id", input.id],
    ["analyst", input.analyst],
    ["market", input.market],
    ["commitmentHash", input.commitmentHash],
    ["committedAt", input.committedAt],
  ]);
}

export function buildPickRevealMemory(input: z.infer<typeof pickRevealSchema>): BuiltMemory {
  return assemble("pick_reveal", [
    ["id", input.id],
    ["selection", input.selection],
    ["odds", input.odds.toString()],
    ["revealedAt", input.revealedAt],
  ]);
}

export function buildOutcomeMemory(input: z.infer<typeof outcomeSchema>): BuiltMemory {
  const pairs: Array<readonly [string, string]> = [
    ["pickId", input.pickId],
    ["result", input.result],
    ["source", input.source],
    ["resolvedAt", input.resolvedAt],
  ];
  if (input.brier !== undefined) pairs.splice(2, 0, ["brier", input.brier.toFixed(6)]);
  return assemble("outcome", pairs);
}

export function buildBiasMemory(input: z.infer<typeof biasSchema>): BuiltMemory {
  return assemble("bias", [
    ["analyst", input.analyst],
    ["pattern", input.pattern],
    ["evidence", input.evidence.toString()],
    ["confidence", input.confidence.toFixed(4)],
  ]);
}

export function buildSourceRoiMemory(input: z.infer<typeof sourceRoiSchema>): BuiltMemory {
  const pairs: Array<readonly [string, string]> = [
    ["provider", input.provider],
    ["spendAtomic", input.spendAtomic],
    ["correct", input.correct.toString()],
    ["wrong", input.wrong.toString()],
  ];
  if (input.note !== undefined) pairs.push(["note", input.note]);
  return assemble("source_roi", pairs);
}

export function buildPreferenceMemory(input: z.infer<typeof preferenceSchema>): BuiltMemory {
  return assemble("preference", [
    ["userId", input.userId],
    ["statement", input.statement],
  ]);
}

export function buildPaymentMemory(input: z.infer<typeof paymentSchema>): BuiltMemory {
  return assemble("payment", [
    ["digest", input.digest],
    ["provider", input.provider],
    ["amountAtomic", input.amountAtomic],
    ["network", input.network],
  ]);
}

export function namespaceFor(prefix: string, userId: string): string {
  return `${prefix}:${userId}`;
}
