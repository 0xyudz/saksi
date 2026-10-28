import { USDC_DECIMALS } from "./config";

/**
 * Parses `X402_PRICE`. A value with `$` is a human USD amount and is scaled to atomic
 * units; a bare integer is already atomic. No floating point arithmetic is involved.
 */
export function parsePriceToAtomic(price: string, decimals: number = USDC_DECIMALS): bigint {
  const trimmed = price.trim();
  const isUsd = trimmed.startsWith("$");
  const numeric = isUsd ? trimmed.slice(1) : trimmed;

  if (!/^\d+(\.\d+)?$/.test(numeric)) {
    throw new Error(`Invalid price: ${price}`);
  }

  if (!isUsd) return BigInt(numeric);

  const [whole, fraction = ""] = numeric.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Price ${price} has more than ${decimals} decimal places`);
  }

  const padded = fraction.padEnd(decimals, "0");
  return BigInt(`${whole}${padded}`);
}

export function formatAtomic(amount: bigint, decimals: number = USDC_DECIMALS): string {
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fraction.length === 0 ? `${sign}${whole}` : `${sign}${whole}.${fraction}`;
}

export function formatUsd(amount: bigint, decimals: number = USDC_DECIMALS): string {
  return `$${formatAtomic(amount, decimals)}`;
}
