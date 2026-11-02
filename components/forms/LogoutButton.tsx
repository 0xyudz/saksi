"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z.object({ ok: z.boolean() }).loose();

/**
 * Logging out clears the only credential this app holds. There is no password and no email,
 * so a user who logs out without their recovery code cannot get back in. The confirmation
 * step exists because that loss is irreversible, not because the click is dangerous.
 *
 * `hasRecovery` is false for journals created before recovery codes existed: for those, the
 * warning is absolute rather than conditional, because no code can ever be presented.
 */
export function LogoutButton({ hasRecovery }: { readonly hasRecovery: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setPending(true);
    setError(null);
    try {
      await requestJson({
        url: "/api/session",
        method: "DELETE",
        schema: responseSchema,
      });
      router.push("/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not end the session.");
    } finally {
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <span className="relative flex items-center gap-2">
        {error ? <span className="text-red text-[10px]">{error}</span> : null}
        <button
          type="button"
          className="mono text-muted hover:text-paper text-[10px] tracking-[0.12em] uppercase"
          onClick={() => setConfirming(true)}
        >
          log out
        </button>
      </span>
    );
  }

  return (
    <div className="border-line bg-panel-raised absolute top-14 right-4 z-50 w-72 rounded-xl border p-4 shadow-xl">
      <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">Before you log out</p>
      <p className="text-muted mt-2 text-xs leading-relaxed">
        {hasRecovery ? (
          <>
            Saksi has no password and no email. Logging out needs your{" "}
            <strong className="text-paper">recovery code</strong> to get back in. If you did not
            save it, this journal is lost.
          </>
        ) : (
          <>
            This journal was created before recovery codes existed, so it has{" "}
            <strong className="text-paper">no way back</strong>. Logging out ends access to it
            permanently.
          </>
        )}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn-ghost h-8 flex-1 text-[11px]"
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep me in
        </button>
        <button
          type="button"
          className="btn btn-primary h-8 flex-1 text-[11px]"
          onClick={logout}
          disabled={pending}
        >
          {pending ? "leaving…" : "Log out"}
        </button>
      </div>
      {error ? <p className="text-red mt-2 text-[10px]">{error}</p> : null}
    </div>
  );
}
