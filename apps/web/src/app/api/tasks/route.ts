/**
 * GET /api/tasks
 *
 * Returns all tasks for the board view (kanban) with worker assignments.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export { endpoint };
export const dynamic = "force-dynamic";

export const GET = createApiRoute(endpoint);
