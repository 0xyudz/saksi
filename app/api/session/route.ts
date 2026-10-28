import { cookies } from "next/headers";

import { SESSION_COOKIE } from "@/lib/config";
import { assertSameOrigin, handleRoute, jsonResponse, parseJsonBody } from "@/lib/http";
import { getSessionUser } from "@/lib/session";
import { createUser, createUserSchema } from "@/server/data/users";

export const dynamic = "force-dynamic";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function GET(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    const user = await getSessionUser();
    return jsonResponse({ user }, requestId);
  });
}

export async function POST(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const input = await parseJsonBody(request, createUserSchema);
    const user = await createUser(input);

    const store = await cookies();
    store.set({
      name: SESSION_COOKIE,
      value: user.id,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE_SECONDS,
    });

    return jsonResponse({ user: { id: user.id, handle: user.handle } }, requestId, {
      status: 201,
    });
  });
}

export async function DELETE(request: Request): Promise<Response> {
  return handleRoute(request, async ({ requestId }) => {
    assertSameOrigin(request);
    const store = await cookies();
    store.delete(SESSION_COOKIE);
    return jsonResponse({ ok: true }, requestId);
  });
}
