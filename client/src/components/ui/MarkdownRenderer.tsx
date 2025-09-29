import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";
import "katex/dist/katex.min.css";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className,
}) => {
  // Preprocess content to convert LaTeX bracket notation to dollar sign notation
  const preprocessMath = (text: string): string => {
    // First, protect existing math expressions from being processed again
    const mathExpressions: string[] = [];
    let mathIndex = 0;
    
    // Protect existing $$ ... $$ expressions
    text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match) => {
      mathExpressions.push(match);
      return `__MATH_BLOCK_${mathIndex++}__`;
    });
    
    // Protect existing $ ... $ expressions
    text = text.replace(/\$([^$\n]+?)\$/g, (match) => {
      mathExpressions.push(match);
      return `__MATH_INLINE_${mathIndex++}__`;
    });

    // Convert block math: \[ ... \] (including multiline) to $$ ... $$
    text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `$$${expr.trim()}$$`);

    // Convert inline math: \( ... \) to $ ... $
    text = text.replace(/\\\((.*?)\\\)/g, (_, expr) => `$${expr.trim()}$`);

    // Restore protected math expressions
    mathIndex = 0;
    text = text.replace(/__MATH_BLOCK_(\d+)__/g, () => mathExpressions[mathIndex++]);
    text = text.replace(/__MATH_INLINE_(\d+)__/g, () => mathExpressions[mathIndex++]);

    return text;
  };

  const processedContent = preprocessMath(content);

  return (
    <div
      className={cn("max-w-none prose prose-sm markdown-content", className)}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Headers
          h1: ({ children }) => (
            <h1 className="mt-4 mb-2 text-lg font-bold text-slate-900 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="mt-3 mb-2 text-base font-bold text-slate-900 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-3 mb-1 text-sm font-semibold text-slate-900 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-2 mb-1 text-sm font-semibold text-slate-800 first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="mt-2 mb-1 text-sm font-medium text-slate-800 first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="mt-2 mb-1 text-sm font-medium text-slate-700 first:mt-0">
              {children}
            </h6>
          ),

          // Paragraphs
          p: ({ children }) => (
            <p className="mb-3 text-sm leading-relaxed text-slate-800 last:mb-0">
              {children}
            </p>
          ),

          // Lists
          ul: ({ children }) => (
            <ul className="list-disc ml-4 pl-2 text-sm text-slate-800 mb-3 space-y-1.5">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal ml-4 pl-2 text-sm text-slate-800 mb-3 space-y-1.5">
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li className="pl-1 text-sm leading-relaxed text-slate-800">
              {children}
            </li>
          ),

          // Code
          code: ({ children, className, ...props }: any) => {
            const isInline = !className?.includes("language-");
            if (isInline) {
              return (
                <code
                  className="bg-slate-100 text-slate-800 px-1 py-0.5 rounded text-xs font-mono"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className={cn(
                  "block overflow-x-auto p-3 font-mono text-xs rounded-md bg-slate-100 text-slate-800",
                  className
                )}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="overflow-x-auto p-3 mb-2 rounded-md bg-slate-100">
              {children}
            </pre>
          ),

          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="py-2 pl-4 mb-2 italic border-l-4 border-slate-300 bg-slate-50 text-slate-700">
              {children}
            </blockquote>
          ),

          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 underline hover:text-blue-800"
            >
              {children}
            </a>
          ),

          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full text-sm border border-collapse border-slate-300">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b border-slate-200">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 font-semibold text-left border border-slate-300 text-slate-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 border border-slate-300 text-slate-800">
              {children}
            </td>
          ),

          // Emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-slate-800">{children}</em>
          ),

          // Strikethrough
          del: ({ children }) => (
            <del className="line-through text-slate-600">{children}</del>
          ),

          // Horizontal rule
          hr: () => <hr className="my-4 border-t border-slate-300" />,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;
