"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z.object({ analyst: z.object({ id: z.string() }).loose() }).loose();

export function NewAnalystForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"human" | "agent" | "source">("human");
  const [externalRef, setExternalRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestJson({
        url: "/api/analysts",
        method: "POST",
        body: {
          name: name.trim(),
          kind,
          ...(externalRef.trim().length === 0 ? {} : { externalRef: externalRef.trim() }),
        },
        schema: responseSchema,
      });
      setName("");
      setExternalRef("");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the analyst.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="analyst-name">
          Analyst name
        </label>
        <input
          id="analyst-name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="The model or person you are tracking"
          minLength={2}
          maxLength={80}
          required
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="analyst-kind">
            Kind
          </label>
          <select
            id="analyst-kind"
            className="select"
            value={kind}
            onChange={(event) => setKind(event.target.value as "human" | "agent" | "source")}
          >
            <option value="human">Human</option>
            <option value="agent">Agent</option>
            <option value="source">Paid source</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="analyst-ref">
            External reference <span className="normal-case">(optional)</span>
          </label>
          <input
            id="analyst-ref"
            className="input"
            value={externalRef}
            onChange={(event) => setExternalRef(event.target.value)}
            placeholder="provider slug, profile URL…"
            maxLength={200}
          />
        </div>
      </div>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Adding…" : "Add analyst"}
      </button>
    </form>
  );
}
