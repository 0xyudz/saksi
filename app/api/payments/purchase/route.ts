import { z } from "zod";

import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { requireApiUserId } from "@/server/auth";
import { pickForUser } from "@/server/data/picks";
import { AppError } from "@/lib/errors";
import { purchaseSignal } from "@/server/usecases/purchase-signal";

export const dynamic = "force-dynamic";

const purchaseSchema = z.object({
  signalId: z.string().uuid(),
  pickId: z.string().uuid().optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const userId = await requireApiUserId();
    const input = await parseJsonBody(request, purchaseSchema);

    if (input.pickId) {
      const pick = await pickForUser(input.pickId, userId);
      if (!pick) throw new AppError("NOT_FOUND", "That pick does not belong to this journal.");
    }

    const purchase = await purchaseSignal(userId, input.signalId, input.pickId);

    return jsonResponse(
      {
        signal: {
          id: purchase.signal.id,
          provider: purchase.signal.provider,
          title: purchase.signal.title,
          payload: purchase.signal.payload,
          priceAtomic: purchase.signal.priceAtomic.toString(),
        },
        payment: {
          id: purchase.payment.id,
          digest: purchase.digest,
          payer: purchase.payer,
          explorerUrl: purchase.explorerUrl,
          amountAtomic: purchase.payment.amountAtomic.toString(),
          verifiedAt: purchase.payment.verifiedAt.toISOString(),
        },
        memory: { blobIds: purchase.memoryBlobIds },
      },
      requestId,
      { status: 201 },
    );
  });
}
