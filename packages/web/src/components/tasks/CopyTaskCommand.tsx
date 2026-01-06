"use client";

import { useState, useCallback } from "react";
import { clsx } from "clsx";
import { getClaudeTaskCommand } from "@/lib/claude-command";

interface CopyTaskCommandProps {
  issueNumber: number;
  taskNumber: number;
  className?: string;
  /** Size variant */
  size?: "sm" | "md";
}

/**
 * Button that copies natural language text for pasting into Claude to start a task.
 */
export function CopyTaskCommand({
  issueNumber,
  taskNumber,
  className,
  size = "md",
}: CopyTaskCommandProps) {
  const [copied, setCopied] = useState(false);

  const command = getClaudeTaskCommand(issueNumber, taskNumber);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [command]);

  const isSmall = size === "sm";

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        "inline-flex items-center font-medium rounded border transition-colors",
        isSmall ? "gap-1 px-1.5 py-0.5 text-xs" : "gap-1.5 px-2 py-1 text-xs",
        copied
          ? "bg-green-50 border-green-200 text-green-700"
          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300",
        className
      )}
      title={command}
    >
      {copied ? (
        <>
          <CheckIcon size={size} />
          Copied!
        </>
      ) : (
        <>
          <CopyIcon size={size} />
          {isSmall ? "For Claude" : "Copy for Claude"}
        </>
      )}
    </button>
  );
}

function CopyIcon({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <svg
      className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <svg
      className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
