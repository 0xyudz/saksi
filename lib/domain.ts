/** Shared domain shapes used by the database layer, use-cases and UI. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type AnalystKind = "human" | "agent" | "source";
export type PickStatus = "sealed" | "revealed" | "resolved" | "void";
export type OutcomeResult = "win" | "loss" | "void";

export interface PickPayload {
  readonly userId: string;
  readonly analystId: string;
  readonly eventRef: string;
  readonly market: string;
  readonly selection: string;
  readonly odds: number;
  readonly stakeUnits: number;
  readonly committedAt: string;
}

export interface MemoryCitation {
  readonly blobId: string;
  readonly text: string;
  readonly distance: number;
  readonly createdAt?: string;
}

export type RecommendationVerdict = "proceed" | "reduce" | "avoid";

export interface RecommendationWarning {
  readonly kind: "bias" | "source_roi" | "credibility" | "calibration";
  readonly message: string;
  readonly evidence: number;
  readonly memory: MemoryCitation | null;
}

export interface RecommendationSource {
  readonly provider: string;
  readonly spendAtomic: string;
  readonly correct: number;
  readonly wrong: number;
  readonly roi: number;
  readonly memory: MemoryCitation | null;
}

export interface RecommendationResponse {
  readonly verdict: RecommendationVerdict;
  readonly confidence: number;
  readonly summary: string;
  readonly reasons: readonly string[];
  readonly warnings: readonly RecommendationWarning[];
  readonly sources: readonly RecommendationSource[];
  readonly citations: readonly MemoryCitation[];
}
