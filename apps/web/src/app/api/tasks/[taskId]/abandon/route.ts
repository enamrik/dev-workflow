/**
 * POST /api/tasks/[taskId]/abandon
 *
 * Abandons a task.
 */

import { createApiRoute } from "@/lib/di/bootstrap";
import { endpoint } from "./endpoint";

export const dynamic = "force-dynamic";

export const POST = createApiRoute(endpoint);
