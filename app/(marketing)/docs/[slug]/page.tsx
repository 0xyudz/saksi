import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownDocument } from "@/components/markdown/MarkdownDocument";
import { DOCS, findDoc, loadDoc } from "@/server/data/docs";

export const dynamic = "force-static";

export function generateStaticParams(): Array<{ slug: string }> {
  return DOCS.map((doc) => ({ slug: doc.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = findDoc(slug);
  if (!entry) return { title: "Document not found" };
  return { title: entry.title, description: entry.summary };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const entry = findDoc(slug);
  if (!entry) notFound();

  const doc = loadDoc(entry);
  const index = DOCS.findIndex((item) => item.slug === entry.slug);
  const previous = index > 0 ? DOCS[index - 1] : undefined;
  const next = index >= 0 && index < DOCS.length - 1 ? DOCS[index + 1] : undefined;

  return (
    <div className="container-page grid gap-12 py-14 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">{entry.eyebrow}</p>
        <nav className="border-line mt-4 space-y-1 border-l">
          {doc.headings.map((heading) => (
            <a
              key={heading.id}
              href={`#${heading.id}`}
              className={`text-muted hover:text-paper hover:border-amber/60 block border-l-2 border-transparent py-1 pl-3 text-[12.5px] leading-snug transition-colors ${
                heading.depth === 3 ? "pl-5 text-[12px]" : ""
              }`}
            >
              {heading.text}
            </a>
          ))}
        </nav>
        <div className="border-line mt-6 border-t pt-4">
          <Link href="/docs" className="link-underline text-muted text-[11px]">
            All documents
          </Link>
        </div>
      </aside>

      <article className="min-w-0">
        <MarkdownDocument blocks={doc.blocks} />

        <nav className="border-line mt-16 grid gap-4 border-t pt-8 sm:grid-cols-2">
          {previous ? (
            <Link href={`/docs/${previous.slug}`} className="card-flat p-5">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Previous</p>
              <p className="text-paper mt-2 text-sm">{previous.title}</p>
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link href={`/docs/${next.slug}`} className="card-flat p-5 sm:text-right">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Next</p>
              <p className="text-paper mt-2 text-sm">{next.title}</p>
            </Link>
          ) : null}
        </nav>
      </article>
    </div>
  );
}
