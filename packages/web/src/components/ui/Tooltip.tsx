"use client";

import * as RadixTooltip from "@radix-ui/react-tooltip";
import { type ReactNode } from "react";
import { clsx } from "clsx";

interface TooltipProps {
  content: string;
  children: ReactNode;
  className?: string;
  /** Delay in ms before showing tooltip (default: 200ms) */
  delayDuration?: number;
  /** Side of the trigger to show tooltip (default: "top") */
  side?: "top" | "right" | "bottom" | "left";
}

export function Tooltip({
  content,
  children,
  className,
  delayDuration = 200,
  side = "top",
}: TooltipProps) {
  return (
    <RadixTooltip.Provider delayDuration={delayDuration}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>
          <span className={clsx("inline-flex", className)}>{children}</span>
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={5}
            className="z-50 px-3 py-1.5 text-xs text-white bg-gray-900 rounded-md shadow-lg max-w-sm animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          >
            {content}
            <RadixTooltip.Arrow className="fill-gray-900" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
