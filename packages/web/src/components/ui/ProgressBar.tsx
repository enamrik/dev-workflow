import { clsx } from "clsx";

interface ProgressBarProps {
  completed: number;
  total: number;
  inProgress?: number;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function ProgressBar({
  completed,
  total,
  inProgress = 0,
  showLabel = true,
  size = "md",
  className,
}: ProgressBarProps) {
  if (total === 0) {
    return null;
  }

  const completedPercent = Math.round((completed / total) * 100);
  const inProgressPercent = Math.round((inProgress / total) * 100);

  return (
    <div className={clsx("flex items-center gap-2", className)}>
      <div
        className={clsx(
          "flex-1 bg-gray-200 rounded-full overflow-hidden",
          size === "sm" ? "h-1.5" : "h-2"
        )}
      >
        <div className="flex h-full">
          <div
            className="bg-green-500 transition-all duration-300"
            style={{ width: `${completedPercent}%` }}
          />
          <div
            className="bg-orange-400 transition-all duration-300"
            style={{ width: `${inProgressPercent}%` }}
          />
        </div>
      </div>
      {showLabel && (
        <span
          className={clsx(
            "text-gray-600 whitespace-nowrap",
            size === "sm" ? "text-xs" : "text-sm"
          )}
        >
          {completed}/{total}
        </span>
      )}
    </div>
  );
}
