import { NewPickForm } from "@/components/forms/NewPickForm";
import { RecommendationForm } from "@/components/forms/RecommendationForm";
import { PageHeader } from "@/components/ui";
import { requireSessionUser } from "@/lib/session";
import { listAnalysts } from "@/server/data/analysts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Seal a pick" };

export default async function NewPickPage() {
  const user = await requireSessionUser();
  const analysts = await listAnalysts();
  const options = analysts.map((analyst) => ({
    id: analyst.id,
    name: analyst.name,
    kind: analyst.kind,
  }));

  return (
    <div>
      <PageHeader
        eyebrow={`@${user.handle} · pre-event`}
        title="Seal before you know."
        description="The commitment is written to Walrus Memory with a canonical sha256 hash. After the event you reveal it, resolve it against a real source, and let the score follow you."
      />

      <div className="container-page grid gap-6 pb-20 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="card p-6">
          <div className="mb-5">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
              1 · Ask memory first
            </p>
            <h2 className="display mt-2 text-3xl">What does your history say?</h2>
            <p className="text-muted mt-2 text-xs leading-relaxed">
              This calls Walrus Memory before the pick exists. Warnings must cite the memory text
              and cosine distance they came from.
            </p>
          </div>
          <RecommendationForm analysts={options} />
        </section>

        <section className="card p-6">
          <div className="mb-5">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">2 · Commit</p>
            <h2 className="display mt-2 text-3xl">Write the sealed pick</h2>
            <p className="text-muted mt-2 text-xs leading-relaxed">
              If Walrus Memory rejects the write, the database row is rolled back. Saksi never shows
              a commitment that is missing from the memory layer.
            </p>
          </div>
          <NewPickForm analysts={options} />
        </section>
      </div>
    </div>
  );
}
