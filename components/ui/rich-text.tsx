import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Safe renderer for the light markdown used in product descriptions and
 * pages. Supports: "## heading", "### heading", "- bullet", "1. item",
 * **bold** and [text](https://link). Never renders raw HTML.
 */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\))/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    if (match[2]) {
      nodes.push(<strong key={`${keyBase}-b${i++}`}>{match[2]}</strong>);
    } else if (match[4] && match[5]) {
      const external = match[5].startsWith("http");
      nodes.push(
        <a
          key={`${keyBase}-a${i++}`}
          href={match[5]}
          {...(external ? { rel: "noopener noreferrer nofollow", target: "_blank" } : {})}
        >
          {match[4]}
        </a>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function RichText({ content, className }: { content: string | null | undefined; className?: string }) {
  if (!content?.trim()) return null;
  const blocks = content.replace(/\r\n/g, "\n").split(/\n{2,}/);

  return (
    <div className={cn("prose-store", className)}>
      {blocks.map((block, bi) => {
        const lines = block.split("\n").filter((l) => l.trim() !== "");
        if (lines.length === 0) return null;
        const key = `blk-${bi}`;

        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={key}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*[-*]\s+/, ""), `${key}-${li}`)}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={key}>
              {lines.map((l, li) => (
                <li key={li}>{renderInline(l.replace(/^\s*\d+[.)]\s+/, ""), `${key}-${li}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <Fragment key={key}>
            {lines.map((line, li) => {
              const k = `${key}-${li}`;
              if (line.startsWith("### ")) return <h3 key={k}>{renderInline(line.slice(4), k)}</h3>;
              if (line.startsWith("## ")) return <h2 key={k}>{renderInline(line.slice(3), k)}</h2>;
              if (line.startsWith("# ")) return <h2 key={k}>{renderInline(line.slice(2), k)}</h2>;
              return <p key={k}>{renderInline(line, k)}</p>;
            })}
          </Fragment>
        );
      })}
    </div>
  );
}
