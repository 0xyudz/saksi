"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({ user: z.object({ id: z.string(), handle: z.string() }).loose() })
  .loose();

export function OnboardingForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestJson({
        url: "/api/session",
        method: "POST",
        body: { handle: handle.trim() },
        schema: responseSchema,
      });
      router.push("/picks");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the journal.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="handle">
          Journal handle
        </label>
        <div className="flex items-center gap-2">
          <span className="mono text-muted text-sm">@</span>
          <input
            id="handle"
            name="handle"
            className="input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="saksi_reader"
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]+"
            autoComplete="username"
            required
          />
        </div>
        <p className="text-muted mt-2 text-xs leading-relaxed">
          Lowercase letters, numbers and underscores. This handle is written into your memories and
          cannot be changed later.
        </p>
      </div>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Opening journal…" : "Open my journal"}
      </button>
    </form>
  );
}
