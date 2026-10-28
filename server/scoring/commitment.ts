import { commitmentHash } from "@/lib/canonical";
import type { PickPayload } from "@/lib/domain";

export interface CommitmentInput {
  readonly userId: string;
  readonly analystId: string;
  readonly eventRef: string;
  readonly market: string;
  readonly selection: string;
  readonly odds: number;
  readonly stakeUnits: number;
  readonly committedAt: string;
}

export function buildPickPayload(input: CommitmentInput): PickPayload {
  if (!Number.isFinite(input.odds) || input.odds <= 1) {
    throw new Error("Odds must be a finite decimal greater than 1");
  }
  if (!Number.isInteger(input.stakeUnits) || input.stakeUnits < 1) {
    throw new Error("Stake must be a positive integer number of units");
  }

  return {
    userId: input.userId,
    analystId: input.analystId,
    eventRef: input.eventRef,
    market: input.market,
    selection: input.selection,
    odds: input.odds,
    stakeUnits: input.stakeUnits,
    committedAt: input.committedAt,
  };
}

export function hashPickPayload(payload: PickPayload): string {
  return commitmentHash(payload);
}

export function verifyCommitment(payload: PickPayload, expectedHash: string): boolean {
  return hashPickPayload(payload) === expectedHash;
}
