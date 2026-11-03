import Link from "next/link";

import { PickCard } from "@/components/PickCard";
import { EmptyState, PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/session";
import { recentPicks } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";

export const dynamic = "force-dynamic";
export const metadata = { title: "Picks" };

export default async function PicksPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();
  const mine = params.mine === "true" && user !== null;
  const feed = await recentPicks(100, mine ? user.id : undefined);

  const picks = feed.map((item) =>
    presentPick({
      pick: item.pick,
      viewerId: user?.id,
      ownerHandle: item.userHandle,
      analystName: item.analystName,
      analystKind: item.analystKind,
      outcome:
        item.outcome === null
          ? null
          : {
              result: item.outcome.result,
              resolvedAt: item.outcome.resolvedAt,
              sourceUrl: item.outcome.sourceUrl,
              resolvedBy: item.outcome.resolvedBy,
              brier: item.outcome.brier,
              payoutUnits: null,
              verification: item.outcome.verification,
              oracleResult: item.outcome.oracleResult,
              oracleNote: item.outcome.oracleNote,
            },
    }),
  );

  return (
    <div>
      <PageHeader
        eyebrow="The ledger"
        title={mine ? "Your sealed journal" : "Every commitment, in order"}
        description="Sealed picks expose only their commitment hash. Revealed and resolved picks show the payload so anyone can recompute the hash and follow the outcome source."
        actions={
          <>
            <Link href={mine ? "/picks" : "/picks?mine=true"} className="btn btn-ghost">
              {mine ? "Show all journals" : "Only mine"}
            </Link>
            {user ? (
              <Link href="/picks/new" className="btn btn-primary">
                Seal a pick
              </Link>
            ) : (
              <Link href="/onboarding" className="btn btn-primary">
                Start a journal
              </Link>
            )}
          </>
        }
      />

      <section className="container-page pb-20">
        {picks.length === 0 ? (
          <EmptyState
            title={mine ? "Your journal is empty" : "No commitments Yet"}
            description={
              mine
                ? "A pick sealed before the event is the only kind that counts. Write the first one."
                : "No one has sealed a pick yet. Be the first commitment in the ledger."
            }
            action={
              <Link href="/picks/new" className="btn btn-primary">
                Seal a pick
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {picks.map((pick) => (
              <PickCard key={pick.id} pick={pick} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
