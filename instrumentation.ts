/**
 * Next.js calls this once per server runtime before serving requests. The build phase
 * must not require production credentials, so it is skipped there; every runtime then
 * fails fast through the same zod schema used by routes and scripts.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const { assertStartupEnvironment } = await import("./lib/startup");
  assertStartupEnvironment();
}
