import { isValidPersonalMessageSignature } from "@mysten/sui/verify";

/**
 * Verifies a wallet's signature over a message, failing closed on every malformed input.
 *
 * `isValidPersonalMessageSignature` throws a `RangeError` when the decoded signature is
 * not the expected length instead of returning `false`. That distinction matters: a
 * caller that only handles the boolean would turn a garbage signature into a 500, which
 * both leaks an internal error and breaks the promise that every rejection is
 * indistinguishable from every other rejection.
 *
 * Kept free of database imports so it can be unit tested directly.
 */
export async function verifyPersonalMessageSignature(input: {
  readonly message: string;
  readonly signature: string;
  readonly address: string;
}): Promise<boolean> {
  if (input.signature.length === 0) return false;

  try {
    return await isValidPersonalMessageSignature(
      new TextEncoder().encode(input.message),
      input.signature,
      { address: input.address },
    );
  } catch {
    // A signature that cannot even be parsed is simply not a valid signature. It must
    // not be reported differently from a well-formed signature over the wrong message.
    return false;
  }
}
