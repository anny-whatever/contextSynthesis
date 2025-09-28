import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className }) => {
  return (
    <div className={cn("prose prose-sm max-w-none markdown-content", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headers
          h1: ({ children }) => (
            <h1 className="text-lg font-bold text-slate-900 mb-2 mt-4 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-base font-bold text-slate-900 mb-2 mt-3 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-semibold text-slate-900 mb-1 mt-3 first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-semibold text-slate-800 mb-1 mt-2 first:mt-0">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-sm font-medium text-slate-800 mb-1 mt-2 first:mt-0">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-sm font-medium text-slate-700 mb-1 mt-2 first:mt-0">
              {children}
            </h6>
          ),
          
          // Paragraphs
          p: ({ children }) => (
            <p className="text-sm leading-relaxed text-slate-800 mb-3 last:mb-0">
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
            <li className="text-sm text-slate-800 leading-relaxed pl-1">
              {children}
            </li>
          ),
          
          // Code
          code: ({ children, className, ...props }: any) => {
            const isInline = !className?.includes('language-');
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
                className={cn("block bg-slate-100 text-slate-800 p-3 rounded-md text-xs font-mono overflow-x-auto", className)}
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-slate-100 p-3 rounded-md mb-2 overflow-x-auto">
              {children}
            </pre>
          ),
          
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-slate-300 pl-4 py-2 mb-2 bg-slate-50 text-slate-700 italic">
              {children}
            </blockquote>
          ),
          
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:text-blue-800 underline"
            >
              {children}
            </a>
          ),
          
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="min-w-full border-collapse border border-slate-300 text-sm">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-slate-100">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody>
              {children}
            </tbody>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-slate-200">
              {children}
            </tr>
          ),
          th: ({ children }) => (
            <th className="border border-slate-300 px-3 py-2 text-left font-semibold text-slate-900">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-slate-300 px-3 py-2 text-slate-800">
              {children}
            </td>
          ),
          
          // Emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-slate-900">
              {children}
            </strong>
          ),
          em: ({ children }) => (
            <em className="italic text-slate-800">
              {children}
            </em>
          ),
          
          // Strikethrough
          del: ({ children }) => (
            <del className="line-through text-slate-600">
              {children}
            </del>
          ),
          
          // Horizontal rule
          hr: () => (
            <hr className="border-t border-slate-300 my-4" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownRenderer;