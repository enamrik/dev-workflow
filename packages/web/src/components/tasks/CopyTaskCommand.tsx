"use client";

import { useState, useCallback } from "react";
import { clsx } from "clsx";

interface CopyTaskCommandProps {
  issueNumber: number;
  taskNumber: number;
  className?: string;
}

/**
 * Button that copies a Claude command to start working on a task.
 */
export function CopyTaskCommand({
  issueNumber,
  taskNumber,
  className,
}: CopyTaskCommandProps) {
  const [copied, setCopied] = useState(false);

  const command = `claude "Start work on task #${issueNumber}.${taskNumber} using the dwf-work-task skill"`;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [command]);

  return (
    <button
      onClick={handleCopy}
      className={clsx(
        "inline-flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded border transition-colors",
        copied
          ? "bg-green-50 border-green-200 text-green-700"
          : "bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100 hover:border-gray-300",
        className
      )}
      title={command}
    >
      {copied ? (
        <>
          <CheckIcon />
          Copied!
        </>
      ) : (
        <>
          <CopyIcon />
          Copy Claude command
        </>
      )}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}
