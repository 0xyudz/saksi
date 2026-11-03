import Link from "next/link";

import { DOCS } from "@/server/data/docs";

export const metadata = {
  title: "Documentation",
  description:
    "The documents that ship with Saksi: the implementation reference, the third-party integration contracts and mainnet proof, the build write-up, and the deploy checklist.",
};

export default function DocsIndexPage() {
  return (
    <div>
      <section className="border-line border-b">
        <div className="container-page py-20">
          <p className="mono text-amber text-[10px] tracking-[0.26em] uppercase">Documentation</p>
          <h1 className="display mt-6 max-w-3xl text-5xl leading-[0.95] sm:text-6xl">
            The documents that ship with the code.
          </h1>
          <p className="text-muted mt-6 max-w-2xl text-[15px] leading-relaxed">
            These are the Markdown files in <code className="mono text-paper">docs/</code> in the
            repository, rendered here without a second copy. They include the trade-offs, the
            failure policy, and the parts that are still unverified.
          </p>
        </div>
      </section>

      <section className="container-page py-16">
        <div className="grid gap-4 md:grid-cols-2">
          {DOCS.map((doc) => (
            <Link
              key={doc.slug}
              href={`/docs/${doc.slug}`}
              className="card group flex flex-col p-6 transition-colors hover:bg-white/[0.03]"
            >
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                {doc.eyebrow}
              </p>
              <h2 className="display mt-3 text-2xl">{doc.title}</h2>
              <p className="text-muted mt-3 flex-1 text-[13.5px] leading-relaxed">{doc.summary}</p>
              <span className="mono text-amber mt-5 text-[11px]">
                Read <span aria-hidden="true">→</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="card-flat mt-8 p-6">
          <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Reading order</p>
          <p className="text-muted mt-3 max-w-3xl text-[13.5px] leading-relaxed">
            If you have ten minutes, read the implementation reference sections on identity, sealed
            picks, Walrus Memory and x402 — those carry the idea of the product. Then read the
            failure policy matrix, which is the table that says what happens when a service is down.
            The integrations document is the one to read if you want to know exactly which SDK call
            produced which proof.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/docs/implementation" className="btn btn-primary h-9 px-4 text-xs">
              Start with the implementation
            </Link>
            <Link href="/how-it-works" className="btn h-9 px-4 text-xs">
              The short version
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
