"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";
import { formatRecoveryCode } from "@/lib/recovery-format";

const responseSchema = z
  .object({
    user: z.object({ id: z.string(), handle: z.string() }).loose(),
    recoveryCode: z.string().min(1),
  })
  .loose();

export function OnboardingForm() {
  const router = useRouter();
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{
    readonly handle: string;
    readonly recoveryCode: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await requestJson({
        url: "/api/session",
        method: "POST",
        body: { handle: handle.trim() },
        schema: responseSchema,
      });
      setCreated({ handle: result.user.handle, recoveryCode: result.recoveryCode });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the journal.");
    } finally {
      setPending(false);
    }
  }

  // The session already exists at this point; the code below is the only copy that will
  // ever be shown, so the user must confirm they stored it before entering the journal.
  if (created !== null) {
    return (
      <div className="space-y-4">
        <div>
          <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
            Journal @{created.handle} created
          </p>
          <h3 className="display mt-2 text-2xl">Save your recovery code</h3>
          <p className="text-muted mt-2 text-xs leading-relaxed">
            There is no password and no email on Saksi. This code is the{" "}
            <strong className="text-paper">only</strong> way back into this journal after you log
            out or clear your cookies. It is shown once and cannot be recovered.
          </p>
        </div>

        <div className="border-amber/40 bg-amber/5 rounded-xl border p-4">
          <p className="mono text-paper text-center text-lg tracking-[0.18em] break-all">
            {formatRecoveryCode(created.recoveryCode)}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost w-full text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(formatRecoveryCode(created.recoveryCode));
          }}
        >
          Copy code
        </button>

        <label className="text-muted flex items-start gap-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I stored this code somewhere safe. I understand it cannot be shown again.</span>
        </label>

        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={!acknowledged}
          onClick={() => {
            router.push("/picks");
            router.refresh();
          }}
        >
          Enter my journal
        </button>
      </div>
    );
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

      <p className="text-muted border-line border-t pt-4 text-center text-xs">
        Already have a journal?{" "}
        <a href="/resume" className="text-amber hover:underline">
          Resume it with your recovery code
        </a>
      </p>
    </form>
  );
}
