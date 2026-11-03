import type { ReactNode } from "react";

import type { InlineNode, MarkdownBlock, TableAlignment } from "@/lib/markdown";

/**
 * Renders the parsed Markdown from `lib/markdown.ts`. There is no `dangerouslySetInnerHTML`
 * anywhere: every node becomes a React element, so a document cannot inject markup even if
 * it is edited by hand.
 */

function renderInline(nodes: readonly InlineNode[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.kind) {
      case "text":
        return node.value;
      case "code":
        return (
          <code
            key={key}
            className="mono bg-panel-raised border-line rounded border px-1.5 py-0.5 text-[0.85em] break-words"
          >
            {node.value}
          </code>
        );
      case "strong":
        return (
          <strong key={key} className="text-paper font-semibold">
            {renderInline(node.children, key)}
          </strong>
        );
      case "emphasis":
        return (
          <em key={key} className="text-paper/90 italic">
            {renderInline(node.children, key)}
          </em>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            className="link-underline text-amber"
            {...(node.href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

const ALIGN_CLASS: Record<TableAlignment, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

function CodeBlock({
  language,
  value,
}: {
  readonly language: string | null;
  readonly value: string;
}) {
  return (
    <div className="border-line bg-panel my-5 overflow-hidden rounded-xl border">
      {language ? (
        <div className="border-line text-muted mono flex items-center justify-between border-b px-4 py-2 text-[10px] tracking-[0.18em] uppercase">
          <span>{language}</span>
        </div>
      ) : null}
      <pre className="overflow-x-auto p-4">
        <code className="mono text-paper/90 text-[12.5px] leading-relaxed">{value}</code>
      </pre>
    </div>
  );
}

export function MarkdownDocument({ blocks }: { readonly blocks: readonly MarkdownBlock[] }) {
  return (
    <div className="min-w-0">
      {blocks.map((block, index) => {
        const key = `block-${index}`;

        switch (block.kind) {
          case "heading": {
            const content = renderInline(block.children, key);
            if (block.depth === 1) {
              return (
                <h1 key={key} id={block.id} className="display text-4xl sm:text-5xl">
                  {content}
                </h1>
              );
            }
            if (block.depth === 2) {
              return (
                <h2
                  key={key}
                  id={block.id}
                  className="display border-line mt-14 scroll-mt-24 border-t pt-8 text-3xl"
                >
                  {content}
                </h2>
              );
            }
            if (block.depth === 3) {
              return (
                <h3 key={key} id={block.id} className="display mt-9 scroll-mt-24 text-2xl">
                  {content}
                </h3>
              );
            }
            return (
              <h4 key={key} id={block.id} className="mt-7 scroll-mt-24 text-base font-semibold">
                {content}
              </h4>
            );
          }

          case "paragraph":
            return (
              <p key={key} className="text-muted mt-4 text-[15px] leading-relaxed">
                {renderInline(block.children, key)}
              </p>
            );

          case "code":
            return <CodeBlock key={key} language={block.language} value={block.value} />;

          case "list": {
            const items = block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`} className="pl-1">
                {renderInline(item, `${key}-${itemIndex}`)}
              </li>
            ));

            if (block.ordered) {
              return (
                <ol
                  key={key}
                  start={block.start}
                  className="text-muted marker:text-amber/70 mt-4 list-decimal space-y-2 pl-6 text-[15px] leading-relaxed"
                >
                  {items}
                </ol>
              );
            }
            return (
              <ul
                key={key}
                className="text-muted marker:text-amber/70 mt-4 list-disc space-y-2 pl-6 text-[15px] leading-relaxed"
              >
                {items}
              </ul>
            );
          }

          case "table":
            return (
              <div key={key} className="border-line my-6 overflow-x-auto rounded-xl border">
                <table className="w-full border-collapse text-left text-[13px]">
                  <thead>
                    <tr className="border-line bg-panel-raised border-b">
                      {block.header.map((cell, cellIndex) => (
                        <th
                          key={`${key}-h-${cellIndex}`}
                          className={`mono text-muted px-3 py-2.5 text-[10px] font-medium tracking-[0.12em] uppercase ${
                            ALIGN_CLASS[block.align[cellIndex] ?? "left"]
                          }`}
                        >
                          {renderInline(cell, `${key}-h-${cellIndex}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr
                        key={`${key}-r-${rowIndex}`}
                        className="border-line/70 border-b last:border-b-0"
                      >
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${key}-r-${rowIndex}-${cellIndex}`}
                            className={`text-muted px-3 py-2.5 align-top leading-relaxed ${
                              ALIGN_CLASS[block.align[cellIndex] ?? "left"]
                            }`}
                          >
                            {renderInline(cell, `${key}-r-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "rule":
            return <div key={key} className="hairline my-10" />;
        }
      })}
    </div>
  );
}
