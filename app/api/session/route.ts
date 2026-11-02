import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { assertSessionOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { assertWithinRateLimit } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/session";
import { signSession } from "@/lib/session-cookie";
import {
  createUser,
  createUserSchema,
  resumeSchema,
  resumeUser,
  type CreatedUser,
} from "@/server/data/users";

export const dynamic = "force-dynamic";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

async function startSession(userId: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE,
    value: signSession(userId, getEnv().SESSION_SECRET),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const user = await getSessionUser();
    return jsonResponse({ user }, requestId);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const input = await parseJsonBody(request, createUserSchema);
    const created: CreatedUser = await createUser(input);
    await startSession(created.user.id);

    return jsonResponse(
      {
        user: { id: created.user.id, handle: created.user.handle },
        // Shown once. There is no endpoint that can reveal it again, by design.
        recoveryCode: created.recoveryCode,
      },
      requestId,
      { status: 201 },
    );
  });
}

/** Resumes an existing journal with its handle and recovery code. */
export async function PATCH(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    assertWithinRateLimit(request, "session:resume", 10, 60_000);
    const input = await parseJsonBody(request, resumeSchema);
    const user = await resumeUser(input);
    await startSession(user.id);

    return jsonResponse({ user: { id: user.id, handle: user.handle } }, requestId);
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSessionOrigin(request);
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return jsonResponse({ ok: true }, requestId);
  });
}
