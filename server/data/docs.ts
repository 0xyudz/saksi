import { readFileSync } from "node:fs";
import { join } from "node:path";

import { collectHeadings, firstParagraph, parseMarkdown } from "@/lib/markdown";
import type { InlineNode, MarkdownBlock, MarkdownHeading } from "@/lib/markdown";

/**
 * The Markdown files in this repository are the source of truth, so the site renders them
 * directly instead of keeping a second copy in JSX. One registry entry per file means a new
 * document is a one-line change here, and a missing file fails at request time with a clear
 * error rather than silently rendering an empty page.
 *
 * `file` is relative to the repository root.
 */

export interface DocEntry {
  readonly slug: string;
  readonly file: string;
  readonly title: string;
  readonly eyebrow: string;
  readonly summary: string;
}

export const DOCS: readonly DocEntry[] = [
  {
    slug: "overview",
    file: "README.md",
    title: "Project overview",
    eyebrow: "Start here",
    summary:
      "What Saksi is, what is implemented, the environment it needs, the routes it serves, the recorded mainnet proof and the known limitations — the same README that ships with the repository.",
  },
  {
    slug: "implementation",
    file: "docs/IMPLEMENTATION.md",
    title: "Implementation reference",
    eyebrow: "Engineering",
    summary:
      "How every subsystem works and why each decision was made: identity, sealed picks, scoring, Walrus Memory, Tatum, x402, the HTTP boundary, the data model and the failure policy matrix.",
  },
  {
    slug: "integrations",
    file: "docs/INTEGRATIONS.md",
    title: "Integrations",
    eyebrow: "Third-party contracts",
    summary:
      "The official sources Saksi was built against, the exact SDK calls used, and the recorded mainnet proof — with an explicit list of what is still unverified.",
  },
  {
    slug: "blog",
    file: "docs/BLOG.md",
    title: "Build notes",
    eyebrow: "Write-up",
    summary:
      "The story behind the build: what the product does, how it uses Walrus Memory and Tatum, and the indexer-lag bug that broke the paywall.",
  },
  {
    slug: "deploy",
    file: "docs/DEPLOY.md",
    title: "Deploy checklist",
    eyebrow: "Operations",
    summary:
      "Step-by-step for running Saksi on Vercel: the repository, the environment variables, the production migration and the post-deploy verification.",
  },
];

/**
 * Each source is read through a literal path rather than a computed one. A computed path
 * (`join(cwd, entry.file)`) makes the bundler treat every file in the project as a potential
 * dependency and trace all of it into the deployment output, which is both slow and large.
 */
const SOURCES: Readonly<Record<string, () => string>> = {
  overview: () => readFileSync(join(process.cwd(), "README.md"), "utf8"),
  implementation: () => readFileSync(join(process.cwd(), "docs", "IMPLEMENTATION.md"), "utf8"),
  integrations: () => readFileSync(join(process.cwd(), "docs", "INTEGRATIONS.md"), "utf8"),
  blog: () => readFileSync(join(process.cwd(), "docs", "BLOG.md"), "utf8"),
  deploy: () => readFileSync(join(process.cwd(), "docs", "DEPLOY.md"), "utf8"),
};

/**
 * The documents link to each other with repository-relative paths (`docs/BLOG.md`), because
 * that is what a reader on GitHub needs. On the site those become routes, otherwise the link
 * 404s. Anchors and absolute URLs are left alone.
 */
function siteHref(href: string): string {
  if (href.startsWith("#") || href.startsWith("http://") || href.startsWith("https://")) {
    return href;
  }
  const normalized = href.replace(/^\.\//, "");
  const target = DOCS.find(
    (entry) => entry.file === normalized || `docs/${entry.file}` === normalized,
  );
  return target ? `/docs/${target.slug}` : href;
}

function rewriteInline(nodes: readonly InlineNode[]): InlineNode[] {
  return nodes.map((node) => {
    switch (node.kind) {
      case "text":
      case "code":
        return node;
      case "strong":
      case "emphasis":
        return { ...node, children: rewriteInline(node.children) };
      case "link":
        return { ...node, href: siteHref(node.href), children: rewriteInline(node.children) };
    }
  });
}

function rewriteBlocks(blocks: readonly MarkdownBlock[]): MarkdownBlock[] {
  return blocks.map((block) => {
    switch (block.kind) {
      case "heading":
        return { ...block, children: rewriteInline(block.children) };
      case "paragraph":
        return { ...block, children: rewriteInline(block.children) };
      case "code":
      case "rule":
        return block;
      case "list":
        return { ...block, items: block.items.map(rewriteInline) };
      case "table":
        return {
          ...block,
          header: block.header.map(rewriteInline),
          rows: block.rows.map((row) => row.map(rewriteInline)),
        };
    }
  });
}

export interface DocPage {
  readonly entry: DocEntry;
  readonly blocks: readonly MarkdownBlock[];
  readonly headings: readonly MarkdownHeading[];
  /** Plain-text opening paragraph, shown on the docs index. */
  readonly intro: string;
}

export function findDoc(slug: string): DocEntry | null {
  return DOCS.find((entry) => entry.slug === slug) ?? null;
}

export function loadDoc(entry: DocEntry): DocPage {
  const read = SOURCES[entry.slug];
  if (!read) throw new Error(`No source registered for document "${entry.slug}".`);
  const blocks = rewriteBlocks(parseMarkdown(read()));
  return {
    entry,
    blocks,
    headings: collectHeadings(blocks, 2),
    intro: firstParagraph(blocks),
  };
}
