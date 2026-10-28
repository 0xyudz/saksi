"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({ memory: z.object({ blobId: z.string(), namespace: z.string() }).loose() })
  .loose();

export function PreferenceForm() {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson({
        url: "/api/memory/preferences",
        method: "POST",
        body: { statement: statement.trim() },
        schema: responseSchema,
      });
      setNotice(`Stored memory ${result.memory.blobId}.`);
      setStatement("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Memory write failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="preference-statement">
          Preference to remember
        </label>
        <input
          id="preference-statement"
          className="input"
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          placeholder="I avoid underdog picks above 4.00 odds"
          minLength={1}
          maxLength={400}
          required
        />
      </div>
      {error ? <p className="text-red text-xs">{error}</p> : null}
      {notice ? <p className="text-green text-xs">{notice}</p> : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Writing memory…" : "Write to Walrus Memory"}
      </button>
    </form>
  );
}
