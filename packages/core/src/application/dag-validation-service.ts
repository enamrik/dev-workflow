/**
 * DAGValidationService validates that task dependencies form a Directed Acyclic Graph
 *
 * Uses depth-first search for cycle detection during plan generation.
 * This ensures that all tasks in a plan can eventually be executed.
 */

import {
  DAGCycleError,
  InvalidDependencyError,
} from "../domain/errors.js";

/**
 * Task node for DAG validation
 */
export interface DAGNode {
  id: string;
  title?: string; // Optional, for error messages
  dependsOn?: string[];
}

/**
 * Node colors for DFS cycle detection
 * - WHITE: Unvisited
 * - GRAY: Currently being visited (in recursion stack)
 * - BLACK: Fully processed
 */
type NodeColor = "WHITE" | "GRAY" | "BLACK";

/**
 * DAGValidationService validates task dependency graphs
 *
 * Ensures:
 * 1. All dependency references are valid (reference existing tasks)
 * 2. No circular dependencies exist
 */
export class DAGValidationService {
  /**
   * Validate that task dependencies form a valid DAG
   *
   * @param tasks - Array of task nodes with dependencies
   * @throws InvalidDependencyError if any dependency references unknown task
   * @throws DAGCycleError if cycle detected
   */
  validateDAG(tasks: DAGNode[]): void {
    // Build task lookup map
    const taskMap = new Map<string, DAGNode>();
    for (const task of tasks) {
      taskMap.set(task.id, task);
    }

    // Validate all dependency references
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          if (!taskMap.has(depId)) {
            throw new InvalidDependencyError(
              task.id,
              task.title ?? task.id,
              depId
            );
          }
        }
      }
    }

    // Build adjacency list (task -> tasks that depend on it)
    const adjacency = new Map<string, string[]>();
    for (const task of tasks) {
      adjacency.set(task.id, []);
    }
    for (const task of tasks) {
      if (task.dependsOn) {
        for (const depId of task.dependsOn) {
          adjacency.get(depId)?.push(task.id);
        }
      }
    }

    // DFS cycle detection with three-color marking
    const colors = new Map<string, NodeColor>();
    for (const task of tasks) {
      colors.set(task.id, "WHITE");
    }

    const path: string[] = [];

    const dfs = (nodeId: string): void => {
      colors.set(nodeId, "GRAY");
      path.push(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighborId of neighbors) {
        const neighborColor = colors.get(neighborId);

        if (neighborColor === "GRAY") {
          // Found cycle - extract cycle path
          const cycleStart = path.indexOf(neighborId);
          const cycle = [...path.slice(cycleStart), neighborId];
          const cycleWithTitles = cycle.map((id) => {
            const node = taskMap.get(id);
            return node?.title ?? id;
          });
          throw new DAGCycleError(cycle, cycleWithTitles.join(" -> "));
        }

        if (neighborColor === "WHITE") {
          dfs(neighborId);
        }
      }

      path.pop();
      colors.set(nodeId, "BLACK");
    };

    // Run DFS from each unvisited node
    for (const task of tasks) {
      if (colors.get(task.id) === "WHITE") {
        dfs(task.id);
      }
    }
  }

  /**
   * Get topological sort of tasks (valid execution order)
   *
   * Returns tasks ordered so that dependencies come before dependents.
   * Assumes DAG has already been validated (no cycles).
   *
   * @param tasks - Array of task nodes with dependencies
   * @returns Task IDs in valid execution order (dependencies first)
   */
  getTopologicalOrder(tasks: DAGNode[]): string[] {
    // Build task lookup and in-degree map
    const taskMap = new Map<string, DAGNode>();
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const task of tasks) {
      taskMap.set(task.id, task);
      inDegree.set(task.id, 0);
      adjacency.set(task.id, []);
    }

    // Build adjacency list and count in-degrees
    for (const task of tasks) {
      if (task.dependsOn) {
        inDegree.set(task.id, task.dependsOn.length);
        for (const depId of task.dependsOn) {
          adjacency.get(depId)?.push(task.id);
        }
      }
    }

    // Kahn's algorithm for topological sort
    const queue: string[] = [];
    const result: string[] = [];

    // Start with nodes that have no dependencies
    for (const task of tasks) {
      if (inDegree.get(task.id) === 0) {
        queue.push(task.id);
      }
    }

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      result.push(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighborId of neighbors) {
        const newDegree = (inDegree.get(neighborId) ?? 0) - 1;
        inDegree.set(neighborId, newDegree);
        if (newDegree === 0) {
          queue.push(neighborId);
        }
      }
    }

    return result;
  }
}
