"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({
    signal: z.object({ id: z.string(), provider: z.string(), title: z.string() }).loose(),
  })
  .loose();

export function SignalIngestForm() {
  const router = useRouter();
  const [externalId, setExternalId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestJson({
        url: "/api/signals",
        method: "POST",
        body: { externalId: externalId.trim() },
        schema: responseSchema,
      });
      setExternalId("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ingestion failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="signal-external-id">
          Provider signal id
        </label>
        <input
          id="signal-external-id"
          className="input"
          value={externalId}
          onChange={(event) => setExternalId(event.target.value)}
          placeholder="the id the configured provider knows"
          maxLength={200}
          required
        />
      </div>
      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Fetching provider…" : "Ingest real signal"}
      </button>
    </form>
  );
}
