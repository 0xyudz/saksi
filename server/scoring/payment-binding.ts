import { AppError } from "@/lib/errors";

/**
 * Pure settlement-binding rules. A Sui digest can only ever pay for one signal and one
 * x402 resource; these checks run before a duplicate receipt is reported as a success.
 */

export interface ExistingPaymentBinding {
  readonly signalId: string;
  readonly resource: string | null;
}

export interface SettlementBindingInput {
  readonly existingPayment: ExistingPaymentBinding;
  readonly requestedSignalId: string;
  readonly expectedResource?: string | null;
}

/**
 * Compares resource URLs without protocol-normalization surprises: hosts are
 * lowercased, query strings and fragments are ignored, and trailing slashes are
 * removed. Path and scheme remain significant.
 */
export function normalizeResourceUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    url.hostname = url.hostname.toLowerCase();
    const trimmedPath = url.pathname.replace(/\/+$/, "");
    url.pathname = trimmedPath === "" ? "/" : trimmedPath;
    return url.toString();
  } catch {
    return value.trim().toLowerCase();
  }
}

/**
 * Rejects a digest that is already recorded for a different signal or resource.
 * Legacy rows with `resource === null` remain valid while the signal id matches.
 */
export function assertSettlementMatchesSignal(input: SettlementBindingInput): void {
  const { existingPayment, requestedSignalId, expectedResource } = input;

  if (existingPayment.signalId !== requestedSignalId) {
    throw new AppError(
      "CONFLICT",
      "This settlement digest is already bound to a different signal.",
    );
  }

  if (
    existingPayment.resource !== null &&
    expectedResource !== undefined &&
    expectedResource !== null &&
    normalizeResourceUrl(existingPayment.resource) !== normalizeResourceUrl(expectedResource)
  ) {
    throw new AppError(
      "CONFLICT",
      "This settlement digest was paid for a different x402 resource.",
    );
  }
}
