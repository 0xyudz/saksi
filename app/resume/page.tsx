import { ResumeForm } from "@/components/forms/ResumeForm";
import { APP_NAME } from "@/lib/config";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const metadata = { title: "Resume a journal" };

export default async function ResumePage() {
  const existing = await getSessionUser();
  if (existing) redirect("/picks");

  return (
    <div className="container-page grid min-h-[70vh] items-center gap-12 py-16 lg:grid-cols-[1.1fr_0.9fr]">
      <div>
        <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">Welcome back</p>
        <h1 className="display mt-5 text-5xl sm:text-6xl">
          Your journal
          <br />
          remembers you.
        </h1>
        <p className="text-muted mt-6 max-w-lg text-[15px] leading-relaxed">
          {APP_NAME} has no passwords and no email, so logging back in takes the recovery code you
          were given when you created the journal. It proves the journal is yours without asking a
          server to trust a name alone.
        </p>
        <ul className="text-muted mt-8 space-y-3 text-sm">
          <li className="flex gap-3">
            <span className="mono text-amber">01</span>
            <span>The code is stored only as a scrypt hash; nobody can read it back.</span>
          </li>
          <li className="flex gap-3">
            <span className="mono text-amber">02</span>
            <span>A wrong handle and a wrong code fail with the same message.</span>
          </li>
          <li className="flex gap-3">
            <span className="mono text-amber">03</span>
            <span>Journals created before recovery existed cannot be resumed.</span>
          </li>
        </ul>
      </div>

      <div className="card p-6 sm:p-8">
        <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Existing journal</p>
        <h2 className="display mt-3 text-3xl">Resume access</h2>
        <p className="text-muted mt-2 mb-6 text-xs leading-relaxed">
          This restores the same session cookie you had before logging out. Your picks, memories and
          payments are untouched.
        </p>
        <ResumeForm />
      </div>
    </div>
  );
}
