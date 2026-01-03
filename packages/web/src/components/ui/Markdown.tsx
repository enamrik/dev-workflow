import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/cjs/styles/prism";
import { clsx } from "clsx";
import type { Components } from "react-markdown";

interface MarkdownProps {
  children: string;
  className?: string;
}

// Custom code renderer that uses SyntaxHighlighter for fenced code blocks
const components: Components = {
  code({ className, children, ...props }) {
    // Check if this is a fenced code block (has language class) or inline code
    const match = /language-(\w+)/.exec(className || "");
    const isCodeBlock = match !== null;

    if (isCodeBlock) {
      const language = match[1];
      const codeString = String(children).replace(/\n$/, "");

      return (
        <SyntaxHighlighter
          style={oneLight}
          language={language}
          PreTag="div"
          customStyle={{
            margin: 0,
            padding: "0.75rem",
            borderRadius: "0.5rem",
            fontSize: "0.875rem",
          }}
        >
          {codeString}
        </SyntaxHighlighter>
      );
    }

    // Inline code - use simple styling
    return (
      <code
        className="text-sm bg-gray-100 px-1 py-0.5 rounded text-gray-800"
        {...props}
      >
        {children}
      </code>
    );
  },
};

export function Markdown({ children, className }: MarkdownProps) {
  return (
    <div
      className={clsx(
        "prose prose-sm max-w-none",
        "prose-headings:text-gray-800 prose-headings:font-semibold",
        "prose-p:text-gray-800 prose-p:my-2",
        "prose-ul:my-2 prose-ol:my-2",
        "prose-li:text-gray-800 prose-li:my-0.5",
        // Inline code handled by custom renderer, but keep these for any prose defaults
        "prose-code:before:content-none prose-code:after:content-none",
        // Pre blocks wrapper - minimal styling since SyntaxHighlighter handles the rest
        "prose-pre:p-0 prose-pre:bg-transparent prose-pre:overflow-x-auto",
        "prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline",
        "prose-strong:text-gray-800",
        "prose-blockquote:border-l-4 prose-blockquote:border-gray-300 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600",
        className
      )}
    >
      <ReactMarkdown components={components}>{children}</ReactMarkdown>
    </div>
  );
}
