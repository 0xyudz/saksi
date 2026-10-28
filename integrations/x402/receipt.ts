import { z } from "zod";

import type { SuiNetwork } from "@/lib/env";
import { AppError } from "@/lib/errors";

/** Validates the x402 settle receipt before it is sent to Tatum for independent proof. */
export const settleReceiptSchema = z
  .object({
    success: z.boolean(),
    transaction: z.string().min(1),
    network: z.string().min(1),
    payer: z.string().optional(),
    amount: z.string().optional(),
    errorReason: z.string().optional(),
    errorMessage: z.string().optional(),
  })
  .loose();

export type SettleReceipt = z.infer<typeof settleReceiptSchema>;

export function parseSettleReceipt(input: unknown, expectedNetwork: SuiNetwork): SettleReceipt {
  const parsed = settleReceiptSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError("PAYMENT_NOT_VERIFIED", "The settlement receipt is malformed.", {
      cause: parsed.error,
    });
  }
  if (!parsed.data.success) {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      parsed.data.errorMessage ??
        parsed.data.errorReason ??
        "The settlement receipt is unsuccessful.",
    );
  }
  if (parsed.data.network !== expectedNetwork) {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      `The receipt network ${parsed.data.network} does not match ${expectedNetwork}.`,
    );
  }
  return parsed.data;
}
