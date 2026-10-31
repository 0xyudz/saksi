import { describe, expect, it } from "vitest";

import {
  suiTransactionResponseSchema,
  toSuiTransactionBlock,
  type SuiTransactionResponse,
} from "@/integrations/tatum/client";

const PAYER = `0x${"1".repeat(64)}`;
const PAY_TO = `0x${"2".repeat(64)}`;
const USDC = `0x${"3".repeat(64)}::usdc::USDC`;
const DIGEST = "GHAuBeydSov1zyT6sUKS2cFxWtNWkeamtKANsHwZJHve";

function transactionOf(parsed: SuiTransactionResponse) {
  if (!parsed.transaction) throw new Error("test payload has no transaction");
  return parsed.transaction;
}

function map(parsed: SuiTransactionResponse) {
  const transaction = transactionOf(parsed);
  return toSuiTransactionBlock(transaction, transaction.effects?.balanceChanges.nodes ?? []);
}

function response(overrides: {
  status?: string;
  executionError?: { message: string } | null;
  timestamp?: string | null;
  sender?: string | null;
  changes?: ReadonlyArray<{
    owner: { address: string } | null;
    coinType: { repr: string } | null;
    amount: string;
  }>;
  events?: ReadonlyArray<{
    contents: { type: { repr: string } | null; json: unknown } | null;
  }>;
}) {
  return suiTransactionResponseSchema.parse({
    transaction: {
      digest: DIGEST,
      sender: overrides.sender === null ? null : { address: overrides.sender ?? PAYER },
      effects: {
        status: overrides.status ?? "SUCCESS",
        executionError: overrides.executionError ?? null,
        timestamp:
          overrides.timestamp === undefined ? "2026-01-23T22:30:07.386Z" : overrides.timestamp,
        balanceChanges: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: overrides.changes ?? [],
        },
        events: { nodes: overrides.events ?? [] },
      },
    },
  });
}

describe("Tatum GraphQL transaction mapping", () => {
  it("maps a successful settlement into the internal transaction shape", () => {
    const parsed = response({
      changes: [
        { owner: { address: PAY_TO }, coinType: { repr: USDC }, amount: "10000" },
        { owner: { address: PAYER }, coinType: { repr: USDC }, amount: "-10000" },
      ],
      events: [{ contents: { type: { repr: `${USDC}::transfer` }, json: { amount: "10000" } } }],
    });

    const block = map(parsed);

    expect(block.digest).toBe(DIGEST);
    expect(block.effects?.status.status).toBe("success");
    expect(block.transaction?.data.sender).toBe(PAYER);
    expect(block.balanceChanges).toEqual([
      { owner: { AddressOwner: PAY_TO }, coinType: USDC, amount: "10000" },
      { owner: { AddressOwner: PAYER }, coinType: USDC, amount: "-10000" },
    ]);
    expect(block.events).toEqual([{ type: `${USDC}::transfer`, parsedJson: { amount: "10000" } }]);
    expect(block.timestampMs).toBe(String(Date.parse("2026-01-23T22:30:07.386Z")));
  });

  it("maps FAILURE status and keeps the execution error message", () => {
    const parsed = response({
      status: "FAILURE",
      executionError: { message: "Insufficient balance" },
    });

    const block = map(parsed);

    expect(block.effects?.status).toEqual({
      status: "failure",
      error: "Insufficient balance",
    });
  });

  it("omits sender and timestamp when Tatum does not return them", () => {
    const parsed = response({ sender: null, timestamp: null });

    const block = map(parsed);

    expect(block.transaction).toBeUndefined();
    expect(block.timestampMs).toBeUndefined();
    expect(block.events).toEqual([]);
  });
});
