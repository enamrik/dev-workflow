import ReactMarkdown from "react-markdown";
import { clsx } from "clsx";

interface MarkdownProps {
  children: string;
  className?: string;
}

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      className={clsx(
        "prose prose-sm max-w-none",
        "prose-headings:text-gray-800 prose-headings:font-semibold",
        "prose-p:text-gray-800 prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2",
        "prose-li:text-gray-800 prose-li:my-0.5",
        "prose-code:text-sm prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none",
        "prose-pre:bg-gray-100 prose-pre:p-3 prose-pre:rounded-lg prose-pre:overflow-x-auto",
        "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-gray-800",
        "prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600",
        className
      )}
    >
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}
