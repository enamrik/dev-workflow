import React from "react";
import { Box, Text } from "ink";

/**
 * Props for ScrollableContent component
 */
export interface ScrollableContentProps {
  /** The text content to display (will be split by newlines) */
  content: string;
  /** Maximum number of lines to display at once */
  maxLines: number;
  /** Current scroll offset (0-indexed line to start from) */
  scrollOffset: number;
  /** Optional callback when scroll changes (for parent-controlled scrolling) */
  onScrollChange?: (offset: number) => void;
  /** Optional text color (defaults to "gray") */
  color?: string;
  /** Optional dimColor prop (defaults to false) */
  dimColor?: boolean;
}

/**
 * A component that renders scrollable text content with scroll indicators.
 *
 * The parent component controls the scroll state via scrollOffset prop.
 * This enables keyboard navigation to be handled at the parent level.
 *
 * Pattern follows KanbanColumn virtual scrolling (KanbanBoard.tsx lines 425-468).
 */
export function ScrollableContent({
  content,
  maxLines,
  scrollOffset,
  color = "gray",
  dimColor = false,
}: ScrollableContentProps): React.ReactElement {
  // Split content by newlines
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Calculate visible window
  const effectiveOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalLines - maxLines)));
  const visibleLines = lines.slice(effectiveOffset, effectiveOffset + maxLines);

  // Calculate scroll indicators
  const hasMoreAbove = effectiveOffset > 0;
  const hasMoreBelow = effectiveOffset + maxLines < totalLines;

  // If content fits, just render it
  if (totalLines <= maxLines) {
    return (
      <Box flexDirection="column">
        {lines.map((line, index) => (
          <Text key={index} color={color} dimColor={dimColor}>
            {line || " "}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* Scroll up indicator */}
      {hasMoreAbove && (
        <Text color="cyan" dimColor>
          ▲ {effectiveOffset} more line{effectiveOffset !== 1 ? "s" : ""} above
        </Text>
      )}

      {/* Visible content */}
      {visibleLines.map((line, index) => (
        <Text key={effectiveOffset + index} color={color} dimColor={dimColor}>
          {line || " "}
        </Text>
      ))}

      {/* Scroll down indicator */}
      {hasMoreBelow && (
        <Text color="cyan" dimColor>
          ▼ {totalLines - effectiveOffset - maxLines} more line
          {totalLines - effectiveOffset - maxLines !== 1 ? "s" : ""} below
        </Text>
      )}
    </Box>
  );
}

/**
 * Utility to calculate scroll boundaries
 */
export function getScrollBounds(
  totalLines: number,
  maxLines: number
): { minOffset: number; maxOffset: number; canScroll: boolean } {
  const canScroll = totalLines > maxLines;
  return {
    minOffset: 0,
    maxOffset: Math.max(0, totalLines - maxLines),
    canScroll,
  };
}

/**
 * Utility to clamp scroll offset within bounds
 */
export function clampScrollOffset(offset: number, totalLines: number, maxLines: number): number {
  const { minOffset, maxOffset } = getScrollBounds(totalLines, maxLines);
  return Math.max(minOffset, Math.min(offset, maxOffset));
}
