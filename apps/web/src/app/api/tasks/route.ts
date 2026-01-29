/**
 * GET /api/tasks
 *
 * Returns all tasks for the board view (kanban) with worker assignments.
 */

import { createApiEndpoint, createApiRoute } from "@/lib/di/bootstrap";
import { listTasksEndpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const endpoint = createApiEndpoint(listTasksEndpoint);

export const GET = createApiRoute(endpoint);
