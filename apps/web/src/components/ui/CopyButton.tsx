"use client";

import { useState, useCallback } from "react";
import { clsx } from "clsx";

interface CopyButtonProps {
  /** The text to copy to clipboard */
  text: string;
  /** Optional label to show (defaults to icon only) */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Tooltip text when hovering */
  tooltip?: string;
  /** Custom icon to show instead of default copy icon */
  icon?: React.ReactNode;
}

/**
 * Reusable button that copies text to clipboard with visual feedback.
 */
export function CopyButton({
  text,
  label,
  className,
  size = "sm",
  tooltip,
  icon,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [text]);

  const sizeClasses = size === "sm" ? "p-1 text-xs" : "px-2 py-1 text-xs";

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        "inline-flex items-center gap-1 rounded border transition-colors",
        copied
          ? "bg-green-50 border-green-200 text-green-700"
          : "bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100 hover:border-gray-300 hover:text-gray-700",
        sizeClasses,
        className
      )}
      title={tooltip || text}
    >
      {copied ? (
        <>
          <CheckIcon size={size} />
          {label && <span>Copied!</span>}
        </>
      ) : (
        <>
          {icon ?? <CopyIcon size={size} />}
          {label && <span>{label}</span>}
        </>
      )}
    </button>
  );
}

function CopyIcon({ size }: { size: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ size }: { size: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";
  return (
    <svg className={sizeClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
