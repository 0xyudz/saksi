"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({ user: z.object({ id: z.string(), handle: z.string() }).loose() })
  .loose();

/**
 * Recovery asks for the code only.
 *
 * The code is the key: its digest names the namespace that holds the journal pointer, so a
 * handle is not needed and would not help — handles are display names now and may be shared,
 * which means they cannot select a journal.
 */
export function ResumeForm() {
  const router = useRouter();
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await requestJson({
        url: "/api/session",
        method: "PATCH",
        body: { recoveryCode },
        schema: responseSchema,
      });
      router.push("/picks");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resume the journal.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="resume-code">
          Recovery code
        </label>
        <input
          id="resume-code"
          className="input mono"
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ"
          autoComplete="off"
          spellCheck={false}
          required
        />
        <p className="text-muted mt-2 text-xs leading-relaxed">
          Dashes, spaces and lowercase are ignored, so you can paste it exactly as you saved it. No
          handle is needed: the code itself names your journal.
        </p>
      </div>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Checking code…" : "Resume my journal"}
      </button>

      <p className="text-muted border-line border-t pt-4 text-center text-xs">
        No code yet?{" "}
        <a href="/onboarding" className="text-amber hover:underline">
          Start a new journal
        </a>
      </p>
    </form>
  );
}
