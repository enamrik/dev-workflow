import { clsx } from "clsx";

type BadgeVariant = "type" | "priority" | "status" | "complexity" | "prStatus";

interface BadgeProps {
  variant: BadgeVariant;
  value: string;
  className?: string;
}

const typeStyles: Record<string, string> = {
  FEATURE: "bg-green-100 text-green-800",
  BUG: "bg-red-100 text-red-800",
  ENHANCEMENT: "bg-green-100 text-green-800",
  TASK: "bg-purple-100 text-purple-800",
};

const priorityStyles: Record<string, string> = {
  LOW: "bg-gray-200 text-gray-700",
  MEDIUM: "bg-orange-100 text-orange-700",
  HIGH: "bg-orange-200 text-orange-800",
  CRITICAL: "bg-red-200 text-red-800",
};

const statusStyles: Record<string, string> = {
  OPEN: "bg-green-100 text-green-800",
  IN_PROGRESS: "bg-orange-100 text-orange-700",
  TASKS_DONE: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-200 text-gray-700",
  // Task statuses
  BACKLOG: "bg-slate-200 text-slate-700",
  READY: "bg-gray-200 text-gray-700",
  PR_REVIEW: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  ABANDONED: "bg-red-100 text-red-700",
};

const complexityStyles: Record<string, string> = {
  LOW: "bg-green-100 text-green-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-700",
  VERY_HIGH: "bg-red-100 text-red-800",
};

const prStatusStyles: Record<string, string> = {
  DRAFT: "bg-gray-200 text-gray-700",
  OPEN: "bg-blue-100 text-blue-800",
  MERGED: "bg-purple-100 text-purple-800",
  CLOSED: "bg-red-100 text-red-700",
};

function getStyleForVariant(variant: BadgeVariant, value: string): string {
  switch (variant) {
    case "type":
      return typeStyles[value] ?? "bg-blue-100 text-blue-800";
    case "priority":
      return priorityStyles[value] ?? "bg-gray-200 text-gray-700";
    case "status":
      return statusStyles[value] ?? "bg-gray-200 text-gray-700";
    case "complexity":
      return complexityStyles[value] ?? "bg-gray-200 text-gray-700";
    case "prStatus":
      return prStatusStyles[value] ?? "bg-gray-200 text-gray-700";
    default:
      return "bg-gray-200 text-gray-700";
  }
}

function formatValue(value: string): string {
  return value.replace(/_/g, " ");
}

export function Badge({ variant, value, className }: BadgeProps) {
  return (
    <span
      className={clsx(
        "inline-block px-2 py-0.5 text-xs font-semibold rounded uppercase tracking-wide",
        getStyleForVariant(variant, value),
        className
      )}
    >
      {formatValue(value)}
    </span>
  );
}
