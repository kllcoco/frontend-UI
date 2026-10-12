import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import CodeBlock from "./CodeBlock";

/** Assistant markdown: GFM tables, LaTeX ($…$, $$…$$, \(…\), \[…\]), highlighted code with copy. */
function normalizeMath(text: string): string {
  return text
    .replace(/^[ \t]*\$\$([^\n$]+?)\$\$[ \t]*$/gm, (_m, body) => "$$\n" + body.trim() + "\n$$")
    .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => "\n$$\n" + body.trim() + "\n$$\n")
    .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => "$" + body.trim() + "$");
}

function Markdown({ text, copyLabel, copiedLabel, canvasLabel, onCanvas }: { text: string; copyLabel: string; copiedLabel: string; canvasLabel?: string; onCanvas?: (language: string, code: string) => void }) {
  return <ReactMarkdown
    remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }], [rehypeHighlight, { detect: true, ignoreMissing: true }]]}
    components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer"/>,
      pre: ({ children }) => <CodeBlock copyLabel={copyLabel} copiedLabel={copiedLabel} canvasLabel={canvasLabel} onCanvas={onCanvas}>{children}</CodeBlock>
    }}>{normalizeMath(text)}</ReactMarkdown>;
}
export default memo(Markdown);
