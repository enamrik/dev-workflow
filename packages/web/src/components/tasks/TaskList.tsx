import { TaskItem } from "./TaskItem";
import type { Task } from "@/lib/types";

interface TaskListProps {
  tasks: Task[];
  projectId?: string;
  issueNumber?: number;
}

export function TaskList({ tasks, projectId, issueNumber }: TaskListProps) {
  return (
    <ul className="space-y-3">
      {tasks.map((task) => (
        <TaskItem key={task.id} task={task} projectId={projectId} issueNumber={issueNumber} />
      ))}
    </ul>
  );
}
