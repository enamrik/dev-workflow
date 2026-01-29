import { TaskItem } from "./TaskItem";
import type { Task } from "@/lib/types";

interface TaskListProps {
  tasks: Task[];
  projectId?: string;
  issueNumber?: number;
  compact?: boolean;
}

export function TaskList({ tasks, projectId, issueNumber, compact = false }: TaskListProps) {
  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <TaskItem
          key={task.id}
          task={task}
          projectId={projectId}
          issueNumber={issueNumber}
          compact={compact}
        />
      ))}
    </ul>
  );
}
