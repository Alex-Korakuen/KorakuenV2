import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

type Props = {
  children: string;
  className?: string;
};

export function Markdown({ children, className }: Props) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-foreground/80 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 whitespace-pre-wrap">{children}</p>,
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-semibold text-foreground">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-sm font-semibold text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1 text-sm font-semibold text-foreground">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-sm font-semibold text-foreground">{children}</h4>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-foreground/70">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">
              {children}
            </pre>
          ),
          hr: () => <hr className="my-3 border-border" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border bg-muted px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
