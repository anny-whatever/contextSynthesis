import React from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';
import type { Components } from 'react-markdown';

interface MarkdownRendererProps {
  children: string;
  className?: string;
  isDarkMode?: boolean;
}

export function MarkdownRenderer({ 
  children: markdown, 
  className,
  isDarkMode = true 
}: MarkdownRendererProps) {
  return (
    <div className={cn("prose prose-sm max-w-none", className)}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom code block renderer with syntax highlighting
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';

            return !inline && match ? (
              <SyntaxHighlighter
                style={isDarkMode ? oneDark : oneLight}
                language={language}
                PreTag="div"
                className="rounded-md"
                showLineNumbers={true}
                lineNumberStyle={{
                  minWidth: '2.5em',
                  paddingRight: '1em',
                  color: isDarkMode ? '#6b7280' : '#9ca3af',
                  borderRight: `1px solid ${isDarkMode ? '#374151' : '#e5e7eb'}`,
                  marginRight: '1em',
                } as any}
                customStyle={{
                  margin: 0,
                  borderRadius: '0.375rem',
                  fontSize: '0.875rem',
                }}
                {...props}
              >
                {String(children).replace(/\n$/, '')}
              </SyntaxHighlighter>
            ) : (
              <code 
                className={cn(
                  "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold",
                  className
                )} 
                {...props}
              >
                {children}
              </code>
            );
          },
          // Custom heading renderers with proper spacing
          h1({ children, ...props }) {
            return (
              <h1 className="scroll-m-20 text-2xl font-extrabold tracking-tight lg:text-3xl mb-4 mt-6" {...props}>
                {children}
              </h1>
            );
          },
          h2({ children, ...props }) {
            return (
              <h2 className="scroll-m-20 border-b pb-2 text-xl font-semibold tracking-tight mb-3 mt-5" {...props}>
                {children}
              </h2>
            );
          },
          h3({ children, ...props }) {
            return (
              <h3 className="scroll-m-20 text-lg font-semibold tracking-tight mb-2 mt-4" {...props}>
                {children}
              </h3>
            );
          },
          h4({ children, ...props }) {
            return (
              <h4 className="scroll-m-20 text-base font-semibold tracking-tight mb-2 mt-3" {...props}>
                {children}
              </h4>
            );
          },
          // Custom paragraph with proper spacing
          p({ children, ...props }) {
            return (
              <p className="leading-7 mb-3" {...props}>
                {children}
              </p>
            );
          },
          // Custom list renderers
          ul({ children, ...props }) {
            return (
              <ul className="my-3 ml-6 list-disc [&>li]:mt-1" {...props}>
                {children}
              </ul>
            );
          },
          ol({ children, ...props }) {
            return (
              <ol className="my-3 ml-6 list-decimal [&>li]:mt-1" {...props}>
                {children}
              </ol>
            );
          },
          li({ children, ...props }) {
            return (
              <li className="leading-7" {...props}>
                {children}
              </li>
            );
          },
          // Custom blockquote
          blockquote({ children, ...props }) {
            return (
              <blockquote className="mt-3 mb-3 border-l-2 pl-6 italic border-muted-foreground/20" {...props}>
                {children}
              </blockquote>
            );
          },
          // Custom table renderers
          table({ children, ...props }) {
            return (
              <div className="my-3 w-full overflow-y-auto">
                <table className="w-full border-collapse border border-muted" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-muted" {...props}>
                {children}
              </thead>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="border border-muted px-4 py-2 text-left font-bold" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="border border-muted px-4 py-2" {...props}>
                {children}
              </td>
            );
          },
          // Custom link styling
          a({ children, href, ...props }) {
            return (
              <a 
                href={href}
                className="font-medium text-primary underline underline-offset-4 hover:text-primary/80"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          // Custom horizontal rule
          hr({ ...props }) {
            return (
              <hr className="my-4 border-muted" {...props} />
            );
          },
          // Custom strong/bold text
          strong({ children, ...props }) {
            return (
              <strong className="font-semibold" {...props}>
                {children}
              </strong>
            );
          },
          // Custom emphasis/italic text
          em({ children, ...props }) {
            return (
              <em className="italic" {...props}>
                {children}
              </em>
            );
          },
          // Custom strikethrough (from remark-gfm)
          del({ children, ...props }) {
            return (
              <del className="line-through text-muted-foreground" {...props}>
                {children}
              </del>
            );
          },
        }}
      >
        {markdown}
      </Markdown>
    </div>
  );
}