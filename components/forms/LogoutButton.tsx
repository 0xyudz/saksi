"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z.object({ ok: z.boolean() }).loose();

export function LogoutButton() {
  const router = useRouter();
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

  return (
    <span className="flex items-center gap-2">
      {error ? <span className="text-red text-[10px]">{error}</span> : null}
      <button
        type="button"
        className="mono text-muted hover:text-paper text-[10px] tracking-[0.12em] uppercase"
        onClick={logout}
        disabled={pending}
      >
        {pending ? "leaving…" : "log out"}
      </button>
    </span>
  );
}
