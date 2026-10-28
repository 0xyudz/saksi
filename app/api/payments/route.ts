import { handleRoute, jsonResponse } from "@/lib/http";
import { agentBalance, eventsForDigests } from "@/server/data/chain";
import { listRecentPayments } from "@/server/data/lifecycle";
import { errorForLog, getLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const payments = await listRecentPayments();

    const [balance, events] = await Promise.allSettled([
      agentBalance(),
      eventsForDigests(payments.map((payment) => payment.digest)),
    ]);

    if (balance.status === "rejected") {
      getLogger().warn({ error: errorForLog(balance.reason) }, "agent balance unavailable");
    }
    if (events.status === "rejected") {
      getLogger().warn({ error: errorForLog(events.reason) }, "on-chain events unavailable");
    }

    return jsonResponse(
      {
        payments: payments.map((payment) => ({
          id: payment.id,
          digest: payment.digest,
          payer: payment.payer,
          payTo: payment.payTo,
          amountAtomic: payment.amountAtomic.toString(),
          network: payment.network,
          verifiedAt: payment.verifiedAt.toISOString(),
          provider: payment.provider,
          signalTitle: payment.signalTitle,
        })),
        balance:
          balance.status === "fulfilled"
            ? { ok: true, ...balance.value }
            : { ok: false, error: "Tatum balance query failed." },
        events:
          events.status === "fulfilled"
            ? { ok: true, items: events.value }
            : { ok: false, error: "Tatum event query failed." },
      },
      requestId,
    );
  });
}
