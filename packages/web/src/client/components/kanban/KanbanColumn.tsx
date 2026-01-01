import { clsx } from "clsx";
import { KanbanCard } from "./KanbanCard";
import type { Task } from "../../api";

interface KanbanTask extends Task {
  issueNumber: number;
  issueTitle: string;
  projectId?: string;
}

interface KanbanColumnProps {
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  tasks: KanbanTask[];
}

export function KanbanColumn({ title, status, tasks }: KanbanColumnProps) {
  const headerColor = {
    PENDING: "bg-gray-100",
    IN_PROGRESS: "bg-orange-100",
    COMPLETED: "bg-green-100",
  }[status];

  return (
    <div className="flex flex-col min-w-[300px] w-[300px] bg-gray-50 rounded-lg">
      {/* Column header */}
      <div
        className={clsx(
          "flex items-center justify-between px-3 py-2 rounded-t-lg",
          headerColor
        )}
      >
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <span className="text-sm text-gray-600 bg-white px-2 py-0.5 rounded">
          {tasks.length}
        </span>
      </div>

      {/* Column content */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)]">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              issueNumber={task.issueNumber}
              issueTitle={task.issueTitle}
              projectId={task.projectId}
            />
          ))
        ) : (
          <div className="text-center text-gray-400 text-sm py-4">No tasks</div>
        )}
      </div>
    </div>
  );
}
