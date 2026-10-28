"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z.object({ verified: z.boolean() }).loose();

export function RevealButton({
  pickId,
  disabledReason,
}: {
  readonly pickId: string;
  readonly disabledReason: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [verified, setVerified] = useState(false);

  async function reveal() {
    setPending(true);
    setError(null);
    try {
      const result = await requestJson({
        url: `/api/picks/${pickId}/reveal`,
        method: "POST",
        schema: responseSchema,
      });
      setVerified(result.verified);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reveal failed.");
    } finally {
      setPending(false);
    }
  }

  if (disabledReason) {
    return <p className="text-muted text-xs">{disabledReason}</p>;
  }

  return (
    <div className="space-y-2">
      <button type="button" className="btn" onClick={reveal} disabled={pending}>
        {pending ? "Verifying commitment…" : "Reveal & verify hash"}
      </button>
      {verified ? (
        <p className="text-green text-xs">
          Recomputing sha256(canonical(pick)) matched the stored commitment.
        </p>
      ) : null}
      {error ? <p className="text-red text-xs">{error}</p> : null}
    </div>
  );
}
