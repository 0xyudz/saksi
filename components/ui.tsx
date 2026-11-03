import Link from "next/link";
import type { ReactNode } from "react";

import type { OutcomeResult, PickStatus } from "@/lib/domain";
import { formatDateTime, shortHash } from "@/lib/format";
import type { OutcomeVerification } from "@/server/presenters/pick";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="container-page pt-14 pb-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-3xl">
          <p className="mono text-amber text-[10px] tracking-[0.24em] uppercase">{eyebrow}</p>
          <h1 className="display mt-4 text-4xl sm:text-5xl">{title}</h1>
          {description ? (
            <p className="text-muted mt-4 max-w-2xl text-[15px] leading-relaxed">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
      </div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone = "paper",
}: {
  readonly label: string;
  readonly value: string | number;
  readonly detail?: string;
  readonly tone?: "paper" | "amber" | "green" | "red";
}) {
  const toneClass = {
    paper: "text-paper",
    amber: "text-amber",
    green: "text-green",
    red: "text-red",
  }[tone];

  return (
    <div className="card p-5">
      <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">{label}</p>
      <p className={`stat-value mt-3 ${toneClass}`}>{value}</p>
      {detail ? <p className="text-muted mt-2 text-xs leading-relaxed">{detail}</p> : null}
    </div>
  );
}

const STATUS_CLASS: Record<PickStatus, string> = {
  sealed: "badge-sealed",
  revealed: "badge-neutral",
  resolved: "badge-success",
  void: "badge-neutral",
};

export function StatusBadge({ status }: { readonly status: PickStatus }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{status}</span>;
}

const OUTCOME_CLASS: Record<OutcomeResult, string> = {
  win: "badge-win",
  loss: "badge-loss",
  void: "badge-neutral",
};

export function OutcomeBadge({ result }: { readonly result: OutcomeResult }) {
  return <span className={`badge ${OUTCOME_CLASS[result]}`}>{result}</span>;
}

const VERIFICATION_LABEL: Record<OutcomeVerification, string> = {
  self_attested: "self-attested",
  oracle_verified: "oracle verified",
  oracle_contradicted: "oracle contradicted",
};

const VERIFICATION_CLASS: Record<OutcomeVerification, string> = {
  self_attested: "badge-neutral",
  oracle_verified: "badge-success",
  oracle_contradicted: "badge-loss",
};

/**
 * Shows how much trust an outcome has earned.
 *
 * This badge exists because a resolved pick proves only that the owner wrote something down
 * — it does not prove the result is true. `oracle verified` means an independent provider
 * agreed; `self-attested` means nobody checked.
 */
export function VerificationBadge({
  verification,
}: {
  readonly verification: OutcomeVerification;
}) {
  return (
    <span className={`badge ${VERIFICATION_CLASS[verification]}`}>
      {VERIFICATION_LABEL[verification]}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="card-flat px-6 py-12 text-center">
      <p className="display text-2xl">{title}</p>
      <p className="text-muted mx-auto mt-3 max-w-md text-sm leading-relaxed">{description}</p>
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ProofLine({
  label,
  value,
  href,
  mono = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly href?: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="border-line flex flex-col gap-1 border-t py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <span className="text-muted text-xs">{label}</span>
      {href ? (
        <Link
          href={href}
          target="_blank"
          rel="noreferrer"
          className={`link-underline text-right text-xs ${mono ? "mono" : ""}`}
        >
          {value}
        </Link>
      ) : (
        <span
          className={`text-paper/90 text-right text-xs break-all ${mono ? "mono" : ""}`}
          title={value}
        >
          {value}
        </span>
      )}
    </div>
  );
}

export function Timestamp({ value }: { readonly value: Date | string }) {
  return <span className="mono text-muted text-[11px]">{formatDateTime(value)}</span>;
}

export function Hash({
  value,
  head,
  tail,
}: {
  readonly value: string;
  readonly head?: number;
  readonly tail?: number;
}) {
  return (
    <span className="mono text-muted text-[11px]" title={value}>
      {shortHash(value, head, tail)}
    </span>
  );
}
