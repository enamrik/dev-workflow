"use client";

import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { KanbanCard } from "./KanbanCard";
import { Tooltip } from "../ui";
import type { Task, ComputedIssueStatus } from "@/lib/types";

const cardAnimation = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: 0.25, ease: "easeOut" as const },
};

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  issueType: "FEATURE" | "BUG" | "ENHANCEMENT" | "TASK" | "SPIKE";
  issueGithubUrl?: string;
  issueComputedStatus: ComputedIssueStatus;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
}

interface KanbanColumnProps {
  title: string;
  status: "PLANNED" | "BACKLOG" | "READY" | "IN_PROGRESS" | "PR_REVIEW" | "COMPLETED";
  tasks: KanbanTask[];
  tooltip?: string;
}

export function KanbanColumn({ title, status, tasks, tooltip }: KanbanColumnProps) {
  const headerColor = {
    PLANNED: "bg-purple-100",
    BACKLOG: "bg-gray-100",
    READY: "bg-gray-100",
    IN_PROGRESS: "bg-orange-100",
    PR_REVIEW: "bg-blue-100",
    COMPLETED: "bg-green-100",
  }[status];

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 min-w-[220px] bg-gray-50 rounded-lg overflow-hidden">
      {/* Column header */}
      <div
        className={clsx("flex items-center justify-between px-3 py-2 rounded-t-lg", headerColor)}
      >
        <div className="flex items-center gap-1">
          <h3 className="font-semibold text-sm md:text-base text-gray-800">{title}</h3>
          {tooltip && (
            <Tooltip content={tooltip}>
              <span className="text-gray-500 cursor-help">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  className="w-4 h-4"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z"
                    clipRule="evenodd"
                  />
                </svg>
              </span>
            </Tooltip>
          )}
        </div>
        <span className="text-sm text-gray-600 bg-white px-2 py-0.5 rounded">{tasks.length}</span>
      </div>

      {/* Column content - flex-1 + min-h-0 allows proper overflow in flex container */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto scrollbar-auto-hide min-h-0">
        <AnimatePresence mode="popLayout">
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <motion.div key={task.id} layoutId={task.id} {...cardAnimation}>
                <KanbanCard
                  task={task}
                  issueNumber={task.issueNumber}
                  issueTitle={task.issueTitle}
                  issueType={task.issueType}
                  issueGithubUrl={task.issueGithubUrl}
                  issueComputedStatus={task.issueComputedStatus}
                  projectId={task.projectId}
                  projectName={task.projectName}
                  projectSlug={task.projectSlug}
                />
              </motion.div>
            ))
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-center text-gray-400 text-sm py-4"
            >
              No tasks
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
